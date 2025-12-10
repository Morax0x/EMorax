const { EmbedBuilder, Colors } = require("discord.js");
const farmAnimals = require('../json/farm-animals.json');

async function checkFarmIncome(client, sql) {
    // فحص أمان أولي لقاعدة البيانات
    if (!sql.open) return;

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1. إنشاء الجدول إذا لم يكن موجوداً (مرة واحدة)
    try {
        sql.prepare("CREATE TABLE IF NOT EXISTS farm_last_payout (id TEXT PRIMARY KEY, lastPayoutDate INTEGER)").run();
    } catch (e) {
        console.error("[Database Error] Could not create farm_last_payout table:", e);
        return;
    }

    // 2. جلب الملاك المميزين فقط
    const farmOwners = sql.prepare("SELECT DISTINCT userID, guildID FROM user_farm").all();
    if (!farmOwners.length) return;

    // تجهيز الاستعلامات مسبقاً لتحسين الأداء
    const stmtCheckPayout = sql.prepare("SELECT lastPayoutDate FROM farm_last_payout WHERE id = ?");
    const stmtGetUserFarm = sql.prepare("SELECT * FROM user_farm WHERE userID = ? AND guildID = ?");
    const stmtUpdatePayout = sql.prepare("INSERT OR REPLACE INTO farm_last_payout (id, lastPayoutDate) VALUES (?, ?)");
    const stmtGetSettings = sql.prepare("SELECT casinoChannelID FROM settings WHERE guild = ?");

    for (const owner of farmOwners) {
        try {
            const { userID, guildID } = owner;
            const payoutID = `${userID}-${guildID}`;

            // ---[ الخطوة 1: فحص الوقت بدقة لمنع السبام ]---
            const lastPayoutData = stmtCheckPayout.get(payoutID);
            
            // إذا وجد سجل، والوقت الحالي أقل من 24 ساعة منذ آخر سحب، تخطى هذا المستخدم
            if (lastPayoutData && (now - lastPayoutData.lastPayoutDate) < ONE_DAY) {
                continue; 
            }

            // ---[ الخطوة 2: حساب الدخل ]---
            const userFarm = stmtGetUserFarm.all(userID, guildID);
            if (!userFarm.length) continue;

            let totalIncome = 0;
            let totalAnimals = 0;

            for (const row of userFarm) {
                const animal = farmAnimals.find(a => a.id === row.animalID);
                if (animal) {
                    // ✅ تصحيح: النظام يخزن كل حيوان كصف مستقل، لذا نجمع الدخل مباشرة
                    totalIncome += animal.income_per_day; 
                    totalAnimals += 1;
                }
            }

            if (totalIncome <= 0) continue;

            // ---[ الخطوة 3: تحديث الرصيد وقاعدة البيانات ]---
            let userData = client.getLevel.get(userID, guildID);
            
            if (!userData) {
                if (!client.defaultData) {
                    // تخطي إذا لم تكن البيانات الافتراضية محملة
                    continue;
                }
                userData = { ...client.defaultData, user: userID, guild: guildID };
            }

            // إضافة الدخل
            userData.mora = (userData.mora || 0) + totalIncome;
            client.setLevel.run(userData);

            // ⚠️ مهم جداً: تسجيل وقت الدفع الحالي فوراً لمنع التكرار في الدورة القادمة
            stmtUpdatePayout.run(payoutID, now);

            // ---[ الخطوة 4: إرسال الإشعار ]---
            const guild = client.guilds.cache.get(guildID);
            if (!guild) continue;

            const settings = stmtGetSettings.get(guildID);
            if (!settings || !settings.casinoChannelID) continue;

            const channel = guild.channels.cache.get(settings.casinoChannelID);
            if (!channel) continue;

            // جلب العضو (مع حماية ضد الأخطاء إذا خرج من السيرفر)
            const member = await guild.members.fetch(userID).catch(() => null);
            if (!member) continue; 

            const EMOJI_MORA = '<:mora:1435647151349698621>'; 

            const embed = new EmbedBuilder()
                .setTitle(`❖ تـم ايـداع دخـل المـزرعـة`)
                .setColor(Colors.Gold)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setImage('https://i.postimg.cc/d0KD5JpH/download.gif')
                .setDescription(
                    `✶ حـققـت مـزرعتـك دخـل بقيمـة: **${totalIncome.toLocaleString()}** ${EMOJI_MORA}\n` +
                    `✶ عـدد الحـيوانات في مـزرعـتـك: **${totalAnimals.toLocaleString()}**`
                )
                .setFooter({ text: `إجمالي دخل المزرعة اليومي: ${totalIncome.toLocaleString()}` })
                .setTimestamp();

            await channel.send({ content: `<@${userID}>`, embeds: [embed] }).catch(err => {
                console.error(`[Farm Msg Error] Can't send to channel ${channel.id}:`, err.message);
            });

        } catch (err) {
            console.error(`[Farm Critical Error] Processing User: ${owner.userID}`, err);
        }
    }
}

module.exports = { checkFarmIncome };
