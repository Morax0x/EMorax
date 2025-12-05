const { Events } = require("discord.js");
const ownerReactionDelete = require("./ownerReactionDelete.js");

// القيم الافتراضية الكاملة (يجب أن تطابق الأعمدة في قاعدة البيانات)
const defaultTotalStats = { 
    total_messages: 0, 
    total_images: 0, 
    total_stickers: 0, 
    total_emojis_sent: 0, // ( 🌟 تمت الإضافة )
    total_reactions_added: 0, 
    total_replies_sent: 0, 
    total_mentions_received: 0, 
    total_vc_minutes: 0, 
    total_disboard_bumps: 0 
};

const defaultDailyStats = {
    messages: 0, images: 0, stickers: 0, emojis_sent: 0, // ( 🌟 تمت الإضافة )
    reactions_added: 0, replies_sent: 0, mentions_received: 0, 
    vc_minutes: 0, water_tree: 0, counting_channel: 0, meow_count: 0, 
    streaming_minutes: 0, disboard_bumps: 0 
};

function safeMerge(base, defaults) {
    const result = { ...base };
    for (const key in defaults) {
        if (result[key] === undefined || result[key] === null) {
            result[key] = defaults[key];
        }
    }
    return result;
}

function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

function getWeekStartDateString() {
    const now = new Date();
    const diff = now.getUTCDate() - (now.getUTCDay() + 2) % 7; 
    const friday = new Date(now.setUTCDate(diff));
    friday.setUTCHours(0, 0, 0, 0); 
    return friday.toISOString().split('T')[0];
}

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        
        // 1. تنفيذ حذف المالك
        try { await ownerReactionDelete.execute(reaction, user); } catch(e) {}

        if (user.bot) return;
        if (!reaction.message.guild) return;

        const client = reaction.client;
        const sql = client.sql;
        
        if (!sql || !sql.open) return;

        const guildID = reaction.message.guild.id;
        const userID = user.id;

        // 3. تتبع إحصائيات الرياكشن
        try {
            const dateStr = getTodayDateString();
            const weekStartDateStr = getWeekStartDateString();
            const dailyStatsId = `${userID}-${guildID}-${dateStr}`;
            const weeklyStatsId = `${userID}-${guildID}-${weekStartDateStr}`;
            const totalStatsId = `${userID}-${guildID}`;

            // جلب البيانات
            let dailyStats = client.getDailyStats.get(dailyStatsId) || { id: dailyStatsId, userID, guildID, date: dateStr };
            let weeklyStats = client.getWeeklyStats.get(weeklyStatsId) || { id: weeklyStatsId, userID, guildID, weekStartDate: weekStartDateStr };
            let totalStats = client.getTotalStats.get(totalStatsId) || { id: totalStatsId, userID, guildID };

            // دمج القيم الافتراضية
            dailyStats = safeMerge(dailyStats, defaultDailyStats);
            weeklyStats = safeMerge(weeklyStats, defaultDailyStats);
            totalStats = safeMerge(totalStats, defaultTotalStats);

            // زيادة العدادات
            dailyStats.reactions_added += 1;
            weeklyStats.reactions_added += 1;
            totalStats.total_reactions_added += 1;

            // الحفظ (باستخدام الدوال الجاهزة في client التي تتوقع كائناً كاملاً)
            client.setDailyStats.run(dailyStats);
            client.setWeeklyStats.run(weeklyStats);
            
            // ( 🌟 الحفظ الكامل والشامل لتجنب خطأ Missing Parameter 🌟 )
            client.setTotalStats.run({
                id: totalStatsId,
                userID,
                guildID,
                total_messages: totalStats.total_messages,
                total_images: totalStats.total_images,
                total_stickers: totalStats.total_stickers,
                total_emojis_sent: totalStats.total_emojis_sent, // ✅ موجود الآن
                total_reactions_added: totalStats.total_reactions_added,
                total_replies_sent: totalStats.total_replies_sent,
                total_mentions_received: totalStats.total_mentions_received,
                total_vc_minutes: totalStats.total_vc_minutes,
                total_disboard_bumps: totalStats.total_disboard_bumps
            });

            // التحقق من المهام
            const member = await reaction.message.guild.members.fetch(userID).catch(() => null);
            if (member && client.checkQuests) {
                await client.checkQuests(client, member, dailyStats, 'daily', dateStr);
                await client.checkQuests(client, member, weeklyStats, 'weekly', weekStartDateStr);
                await client.checkAchievements(client, member, null, totalStats);
            }

        } catch (err) {
            // تجاهل الخطأ إذا كان بسبب قاعدة البيانات المغلقة مؤقتاً
            if (!err.message.includes('database connection is not open')) {
                console.error("[Reaction Stats Error]", err);
            }
        }
    },
};
