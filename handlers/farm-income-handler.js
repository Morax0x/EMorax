const { EmbedBuilder, Colors } = require("discord.js");
const farmAnimals = require('../json/farm-animals.json');

async function checkFarmIncome(client, sql) {
    // فحص أمان
    if (!sql.open) return;

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1. التأكد من وجود جدول لتسجيل آخر وقت للحصاد (لتجنب التكرار)
    try {
        sql.prepare("CREATE TABLE IF NOT EXISTS farm_last_payout (id TEXT PRIMARY KEY, lastPayoutDate INTEGER)").run();
    } catch (e) {}

    // 2. جلب جميع المستخدمين الذين يملكون حيوانات في المزرعة (بدون تكرار)
    const farmOwners = sql.prepare("SELECT DISTINCT userID, guildID FROM user_farm").all();

    if (farmOwners.length === 0) return;

    for (const owner of farmOwners) {
        try {
            const { userID, guildID } = owner;
            const payoutID = `${userID}-${guildID}`;

            // 3. التحقق من الكولداون (هل مر يوم كامل؟)
            const lastPayoutData = sql.prepare("SELECT lastPayoutDate FROM farm_last_payout WHERE id = ?").get(payoutID);
            
            // إذا كان مسجلاً ولم يمر يوم، تخطى هذا المستخدم
            if (lastPayoutData && (lastPayoutData.lastPayoutDate + ONE_DAY) > now) {
                continue; 
            }

            // 4. حساب الدخل وعدد الحيوانات
            const userFarm = sql.prepare("SELECT * FROM user_farm WHERE userID = ? AND guildID = ?").all(userID, guildID);
            
            let totalIncome = 0;
            let totalAnimals = 0;

            for (const row of userFarm) {
                const animal = farmAnimals.find(a => a.id === row.animalID);
                if (animal) {
                    // الدخل = دخل الحيوان * الكمية
                    totalIncome += (animal.income_per_day * row.quantity);
                    totalAnimals += row.quantity;
                }
            }

            // إذا لم يكن هناك دخل (0)، لا تفعل شيئاً
            if (totalIncome <= 0) continue;

            // 5. إيداع المبلغ وتحديث الوقت
            let userData = client.getLevel.get(userID, guildID);
            if (!userData) {
                // إنشاء داتا افتراضية إذا لم تكن موجودة
                userData = { ...client.defaultData, user: userID, guild: guildID };
            }

            userData.mora += totalIncome;
            client.setLevel.run(userData);

            // تحديث وقت آخر حصاد إلى "الآن"
            sql.prepare("INSERT OR REPLACE INTO farm_last_payout (id, lastPayoutDate) VALUES (?, ?)").run(payoutID, now);

            // 6. إرسال الرسالة (الإيمبد)
            const guild = client.guilds.cache.get(guildID);
            if (!guild) continue;

            // تحديد القناة (نفس قناة الكازينو أو قناة محددة)
            const settings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?").get(guildID);
            if (settings && settings.casinoChannelID) {
                const channel = guild.channels.cache.get(settings.casinoChannelID);
                if (channel) {
                    const member = await guild.members.fetch(userID).catch(() => null);
                    if (!member) continue;

                    const EMOJI_MORA = '<:mora:1435647151349698621>'; // تأكد من الايموجي

                    const embed = new EmbedBuilder()
                        .setTitle(`❖ تـم ايـداع دخـل المـزرعـة`)
                        .setColor(Colors.Gold) // لون ذهبي
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true })) // صورة المستخدم صغيرة
                        .setImage('https://i.postimg.cc/d0KD5JpH/download.gif') // الصورة الكبيرة
                        .setDescription(
                            `✶ حـققـت مـزرعتـك دخـل بقيمـة: **${totalIncome.toLocaleString()}** ${EMOJI_MORA}\n` +
                            `✶ عـدد الحـيوانات في مـزرعـتـك: **${totalAnimals.toLocaleString()}**`
                        )
                        .setFooter({ text: `إجمالي دخل المزرعة: ${totalIncome.toLocaleString()} بـاليـوم` });

                    // المنشن يكون خارج الايمبد (في الـ content)
                    await channel.send({ content: `<@${userID}>`, embeds: [embed] });
                }
            }

        } catch (err) {
            console.error(`[Farm Income Error] User: ${owner.userID}`, err);
        }
    }
}

module.exports = { checkFarmIncome };
