const { EmbedBuilder, Colors } = require("discord.js");
const farmAnimals = require('../json/farm-animals.json');

async function checkLoanPayments(client, sql) {
    if (!sql.open) return;

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    const activeLoans = sql.prepare("SELECT * FROM user_loans WHERE remainingAmount > 0 AND (lastPaymentDate + ?) <= ?").all(ONE_DAY, now);

    if (activeLoans.length === 0) return;

    for (const loan of activeLoans) {
        try {
            const guild = client.guilds.cache.get(loan.guildID);
            if (!guild) continue;

            let userData = client.getLevel.get(loan.userID, loan.guildID);
            if (!userData) continue;

            // جلب العضو للصورة والاسم
            const member = await guild.members.fetch(loan.userID).catch(() => null);
            if (!member) continue;

            const paymentAmount = Math.min(loan.dailyPayment, loan.remainingAmount);
            let remainingToPay = paymentAmount;
            let deductionDetails = ""; // لتخزين تفاصيل الخصم (النص السفلي)
            
            const EMOJI_MORA = client.EMOJI_MORA || '🪙'; 

            // 1. الخصم من المورا
            if (userData.mora > 0) {
                const takeMora = Math.min(userData.mora, remainingToPay);
                userData.mora -= takeMora;
                remainingToPay -= takeMora;
                if (takeMora > 0) {
                    deductionDetails += `💸 **خصم مورا:** تم استقطاع **${takeMora.toLocaleString()}** ${EMOJI_MORA}\n`;
                }
            }

            // 2. تسييل أصول السوق
            if (remainingToPay > 0) {
                 const portfolio = sql.prepare("SELECT * FROM user_portfolio WHERE userID = ? AND guildID = ?").all(loan.userID, loan.guildID);
                 for (const item of portfolio) {
                     if (remainingToPay <= 0) break;
                     const marketData = sql.prepare("SELECT currentPrice, name FROM market_items WHERE id = ?").get(item.itemID);
                     if (!marketData) continue; 
                     const price = marketData.currentPrice;
                     const neededQty = Math.ceil(remainingToPay / price);
                     const sellQty = Math.min(item.quantity, neededQty);
                     const value = sellQty * price;
                     
                     if (sellQty >= item.quantity) {
                         sql.prepare("DELETE FROM user_portfolio WHERE id = ?").run(item.id);
                     } else {
                         sql.prepare("UPDATE user_portfolio SET quantity = quantity - ? WHERE id = ?").run(sellQty, item.id);
                     }
                     
                     if (value > remainingToPay) {
                         userData.mora += (value - remainingToPay);
                         remainingToPay = 0;
                     } else {
                         remainingToPay -= value;
                     }
                     deductionDetails += `📉 **تسييل أصول:** تم بيع **${sellQty}x ${marketData.name}**\n`;
                 }
            }

            // 3. بيع حيوانات المزرعة
            if (remainingToPay > 0) {
                 const farm = sql.prepare("SELECT * FROM user_farm WHERE userID = ? AND guildID = ?").all(loan.userID, loan.guildID);
                 for (const animalRow of farm) {
                     if (remainingToPay <= 0) break;
                     const animalData = farmAnimals.find(a => a.id === animalRow.animalID);
                     if (!animalData) continue;
                     const price = animalData.price;
                     sql.prepare("DELETE FROM user_farm WHERE id = ?").run(animalRow.id);
                     if (price > remainingToPay) {
                         userData.mora += (price - remainingToPay);
                         remainingToPay = 0;
                     } else {
                         remainingToPay -= price;
                     }
                     deductionDetails += `🚜 **بيع مزرعة:** تم بيع **${animalData.name}**\n`;
                 }
            }

            // 4. عقوبة XP
            if (remainingToPay > 0) {
                const xpPenalty = Math.floor(remainingToPay * 2);
                if (userData.xp >= xpPenalty) {
                    userData.xp -= xpPenalty; 
                } else { 
                    userData.xp = 0; 
                    if (userData.level > 1) userData.level -= 1; 
                }
                deductionDetails += `⚠️ **عقوبة:** تم خصم **${xpPenalty.toLocaleString()}** XP لعدم كفاية الرصيد\n`;
                remainingToPay = 0; 
            }

            client.setLevel.run(userData);
            
            loan.remainingAmount -= paymentAmount;
            loan.lastPaymentDate = now;

            if (loan.remainingAmount <= 0) {
                sql.prepare("DELETE FROM user_loans WHERE userID = ? AND guildID = ?").run(loan.userID, loan.guildID);
                deductionDetails += `\n🎉 **تم سداد القرض بالكامل!**`;
            } else {
                sql.prepare("UPDATE user_loans SET remainingAmount = ?, lastPaymentDate = ? WHERE userID = ? AND guildID = ?").run(loan.remainingAmount, now, loan.userID, loan.guildID);
            }

            // إرسال الإيمبد
            const settings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guild.id);
            if (settings && settings.casinoChannelID) {
                const channel = guild.channels.cache.get(settings.casinoChannelID);
                if (channel && deductionDetails) {
                    
                    const daysLeft = Math.ceil(loan.remainingAmount / loan.dailyPayment);

                    const embed = new EmbedBuilder()
                        .setTitle(`❖ تحـصـيـل القـرض`)
                        .setColor(Colors.Gold)
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .setImage('https://i.postimg.cc/vmrBxCqF/download-(1).gif')
                        .setDescription(
                            `**تفاصيل القرض:**\n` +
                            `- قيمة القسط: **${paymentAmount.toLocaleString()}** ${EMOJI_MORA}\n` +
                            `- المتبقي من القرض: **${loan.remainingAmount.toLocaleString()}** ${EMOJI_MORA}\n` +
                            `- ايـام السداد المتبقية: **${daysLeft}** يوم\n\n` +
                            `**تفاصيل العملية:**\n${deductionDetails}`
                        );

                    await channel.send({ content: `<@${loan.userID}>`, embeds: [embed] });
                }
            }

        } catch (err) {
            console.error("[Loan Handler Error]", err);
        }
    }
}

module.exports = { checkLoanPayments };
