const { Events } = require("discord.js");

// قائمة لمنع التكرار (Cooldown) لمدة دقيقة
const treeCooldowns = new Set();

function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function getWeekStartDateString() {
    const now = new Date(); const diff = now.getUTCDate() - (now.getUTCDay() + 2) % 7; 
    const friday = new Date(now.setUTCDate(diff)); friday.setUTCHours(0, 0, 0, 0); return friday.toISOString().split('T')[0];
}

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        // 1. جلب الرسالة إذا كانت غير محملة
        if (newMessage.partial) {
            try { await newMessage.fetch(); } catch (e) { return; }
        }
        
        if (!newMessage.guild || !newMessage.author) return;

        const client = newMessage.client;
        const sql = client.sql;

        try {
            // 2. جلب الإعدادات
            const settings = sql.prepare("SELECT * FROM settings WHERE guild = ?").get(newMessage.guild.id);
            
            // إذا لم يتم تحديد البوت أو القناة، لن يعمل الكود
            if (!settings || !settings.treeBotID || !settings.treeChannelID) {
                // console.log("[Tree] Settings missing. Please run -sqc treebot and -sqc treechannel");
                return;
            }

            // 3. المطابقة (هل التعديل في القناة الصحيحة ومن البوت الصحيح؟)
            if (newMessage.channel.id !== settings.treeChannelID) return;
            if (newMessage.author.id !== settings.treeBotID) return;

            // 4. استخراج النصوص (من الوصف، العنوان، الحقول)
            let fullContent = newMessage.content || "";
            
            if (newMessage.embeds.length > 0) {
                const embed = newMessage.embeds[0];
                fullContent += " " + (embed.description || "");
                fullContent += " " + (embed.title || "");
                if (embed.fields) {
                    embed.fields.forEach(f => fullContent += " " + f.value);
                }
            }

            // 5. البحث عن المنشن
            const match = fullContent.match(/<@!?(\d+)>/);

            if (match && match[1]) {
                const userID = match[1];

                // تجاهل البوتات
                if (userID === client.user.id || userID === settings.treeBotID) return;

                // 6. التحقق من التكرار (هل حسبناها له قبل شوي؟)
                if (treeCooldowns.has(userID)) {
                    console.log(`[Tree] Ignored duplicate update for ${userID}`);
                    return;
                }

                // إضافة للمؤقت
                treeCooldowns.add(userID);
                setTimeout(() => treeCooldowns.delete(userID), 60000); // انتظار دقيقة

                // 7. تسجيل النقاط (SQL مباشر)
                const guildID = newMessage.guild.id;
                const dateStr = getTodayDateString();
                const weekStr = getWeekStartDateString();
                const dailyID = `${userID}-${guildID}-${dateStr}`;
                const weeklyID = `${userID}-${guildID}-${weekStr}`;

                console.log(`[Tree] 🌳 Water detected for: ${userID}`);

                sql.prepare(`INSERT INTO user_daily_stats (id, userID, guildID, date, water_tree) VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET water_tree = water_tree + 1`).run(dailyID, userID, guildID, dateStr);
                sql.prepare(`INSERT INTO user_weekly_stats (id, userID, guildID, weekStartDate, water_tree) VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET water_tree = water_tree + 1`).run(weeklyID, userID, guildID, weekStr);

                // 8. فحص الجوائز
                const member = await newMessage.guild.members.fetch(userID).catch(() => null);
                if (member && client.checkQuests) {
                    // نرسل قيمة وهمية كبيرة لضمان تفعيل الفحص
                    await client.checkQuests(client, member, { water_tree: 1000 }, 'daily', dateStr);
                    await client.checkQuests(client, member, { water_tree: 1000 }, 'weekly', weekStr);
                }
            }

        } catch (err) {
            console.error("[Tree Quest Error]", err);
        }
    },
};
