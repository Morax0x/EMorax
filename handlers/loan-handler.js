const { EmbedBuilder } = require("discord.js");
const farmAnimals = require('../json/farm-animals.json'); // تأكد من صحة المسار

async function checkLoanPayments(client, sql) {
    // فحص أمان
    if (!sql.open) return;

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // جلب القروض المستحقة (التي مر عليها يوم منذ آخر سداد)
    const activeLoans = sql.prepare("SELECT * FROM user_loans WHERE remainingAmount > 0 AND (lastPaymentDate + ?) <= ?").all(ONE_DAY, now);

    if (activeLoans.length === 0) return;

    for (const loan of activeLoans) {
        try {
            const guild = client.guilds.cache.get(loan.guildID);
            if (!guild) continue;

            let userData = client.getLevel.get(loan.userID, loan.guildID);
            if (!userData) continue;

            const paymentAmount = Math.min(loan.dailyPayment, loan.remainingAmount);
            let remainingToPay = paymentAmount;
            let msgContent = "";
            
            // لاستخدام الايموجي المعرف في الكلاينت
            const EMOJI_MORA = client.EMOJI_MORA || '🪙'; 

            // ---------------------------------------------------
            // 1. الخصم من المورا (الكاش) - الأولوية الأولى
            // ---------------------------------------------------
            if (userData.mora > 0) {
                const takeMora = Math.min(userData.mora, remainingToPay);
                userData.mora -= takeMora;
                remainingToPay -= takeMora;
                if (takeMora > 0) {
                    msgContent += `💸 **سداد تلقائي:** تم استقطاع **${takeMora.toLocaleString()}** مورا من <@${loan.userID}> كدفعة للقرض.`;
                }
            }

            // ---------------------------------------------------
            // 2. تسييل أصول السوق - الأولوية الثانية
            // ---------------------------------------------------
            if (remainingToPay > 0) {
                 const portfolio = sql.prepare("SELECT * FROM user_portfolio WHERE userID = ? AND guildID = ?").all(loan.userID, loan.guildID);
                 
                 for (const item of portfolio) {
                     if (remainingToPay <= 0) break;
                     
                     const marketData = sql.prepare("SELECT currentPrice, name FROM market_items WHERE id = ?").get(item.itemID);
                     // تخطي إذا لم يكن عنصراً في السوق (مثل الطعوم) أو غير موجود
                     if (!marketData) continue; 
                     
                     const price = marketData.currentPrice;
                     // حساب الكمية المطلوبة للسداد
                     const neededQty = Math.ceil(remainingToPay / price);
                     const sellQty = Math.min(item.quantity, neededQty);
                     const value = sellQty * price;
                     
                     // تحديث المحفظة
                     if (sellQty >= item.quantity) {
                         sql.prepare("DELETE FROM user_portfolio WHERE id = ?").run(item.id);
                     } else {
                         sql.prepare("UPDATE user_portfolio SET quantity = quantity - ? WHERE id = ?").run(sellQty, item.id);
                     }
                     
                     // خصم القيمة من الدين
                     if (value > remainingToPay) {
                         userData.mora += (value - remainingToPay); // الفائض يرجع للكاش
                         remainingToPay = 0;
                     } else {
                         remainingToPay -= value;
                     }
                     
                     msgContent += `\n📉 **تسييل أصول:** تم بيع **${sellQty}x ${marketData.name}** من المحفظة لسداد جزء من الدين.`;
                 }
            }

            // ---------------------------------------------------
            // 3. بيع حيوانات المزرعة - الأولوية الثالثة
            // ---------------------------------------------------
            if (remainingToPay > 0) {
                 const farm = sql.prepare("SELECT * FROM user_farm WHERE userID = ? AND guildID = ?").all(loan.userID, loan.guildID);
                 
                 for (const animalRow of farm) {
                     if (remainingToPay <= 0) break;
                     
                     const animalData = farmAnimals.find(a => a.id === animalRow.animalID);
                     if (!animalData) continue;
                     
                     const price = animalData.price; // نبيع بسعر الشراء كتعويض سريع (أو يمكن وضع سعر بيع أقل)
                     
                     sql.prepare("DELETE FROM user_farm WHERE id = ?").run(animalRow.id);
                     
                     if (price > remainingToPay) {
                         userData.mora += (price - remainingToPay);
                         remainingToPay = 0;
                     } else {
                         remainingToPay -= price;
                     }
                     
                     msgContent += `\n🚜 **بيع قسري:** تم بيع **${animalData.name}** من المزرعة لسداد الدين.`;
                 }
            }

            // ---------------------------------------------------
            // 4. عقوبة الـ XP - الحل الأخير
            // ---------------------------------------------------
            if (remainingToPay > 0) {
                const xpPenalty = Math.floor(remainingToPay * 2); // العقوبة ضعف المبلغ المتبقي
                if (userData.xp >= xpPenalty) {
                    userData.xp -= xpPenalty; 
                } else { 
                    userData.xp = 0; 
                    if (userData.level > 1) userData.level -= 1; 
                }
                msgContent += `\n⚠️ **تنبيه:** الأصول لم تكفِ! تم خصم **${xpPenalty.toLocaleString()}** XP كعقوبة تأخير من <@${loan.userID}>.`;
                remainingToPay = 0; // نعتبر القسط مدفوعاً بالعقوبة
            }

            // حفظ البيانات وتحديث القرض
            client.setLevel.run(userData);
            
            loan.remainingAmount -= paymentAmount;
            loan.lastPaymentDate = now;

            if (loan.remainingAmount <= 0) {
                sql.prepare("DELETE FROM user_loans WHERE userID = ? AND guildID = ?").run(loan.userID, loan.guildID);
                msgContent += `\n🎉 **مبروك!** لقد تم سداد القرض بالكامل.`;
            } else {
                sql.prepare("UPDATE user_loans SET remainingAmount = ?, lastPaymentDate = ? WHERE userID = ? AND guildID = ?").run(loan.remainingAmount, now, loan.userID, loan.guildID);
            }

            // إرسال الرسالة إلى قناة الكازينو
            const settings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guild.id);
            if (settings && settings.casinoChannelID) {
                const casinoChannel = guild.channels.cache.get(settings.casinoChannelID);
                if (casinoChannel && msgContent) {
                    casinoChannel.send(msgContent).catch(() => {});
                }
            }

        } catch (err) {
            console.error("[Loan Handler Error]", err);
        }
    }
}

module.exports = { checkLoanPayments };
