const { joinVoiceChannel } = require('@discordjs/voice');
const { ActivityType } = require('discord.js');

module.exports = async (client) => {
    const sql = client.sql;

    console.log("🔄 [Auto-Join] Checking saved voice channels and status...");

    // 1. استعادة الحالة (Status)
    try {
        const savedStatus = sql.prepare("SELECT savedStatusType, savedStatusText FROM settings WHERE savedStatusText IS NOT NULL LIMIT 1").get();
        
        if (savedStatus) {
            let type = ActivityType.Playing;
            if (savedStatus.savedStatusType === 'Watching') type = ActivityType.Watching;
            else if (savedStatus.savedStatusType === 'Listening') type = ActivityType.Listening;
            else if (savedStatus.savedStatusType === 'Streaming') type = ActivityType.Streaming;
            else if (savedStatus.savedStatusType === 'Competing') type = ActivityType.Competing;
            else if (savedStatus.savedStatusType === 'Custom') type = ActivityType.Custom;

            // إذا كانت الحالة Custom
            if (type === ActivityType.Custom) {
                client.user.setPresence({
                    activities: [{ name: savedStatus.savedStatusText, type: type, state: savedStatus.savedStatusText }],
                    status: 'online'
                });
            } else {
                // الحالات الأخرى
                client.user.setPresence({
                    activities: [{ name: savedStatus.savedStatusText, type: type }],
                    status: 'online'
                });
            }
            console.log(`✅ [Status] Restored: ${savedStatus.savedStatusType} ${savedStatus.savedStatusText}`);
        }
    } catch (e) {
        console.error("[Auto-Join] Error restoring status:", e.message);
    }

    // 2. استعادة القنوات الصوتية
    try {
        const settings = sql.prepare("SELECT guild, voiceChannelID FROM settings WHERE voiceChannelID IS NOT NULL").all();

        for (const data of settings) {
            const guild = client.guilds.cache.get(data.guild);
            if (!guild) continue;

            const channel = guild.channels.cache.get(data.voiceChannelID);
            if (!channel || !channel.isVoiceBased()) {
                // القناة حذفت؟ نحذفها من الداتابيس
                sql.prepare("UPDATE settings SET voiceChannelID = NULL WHERE guild = ?").run(data.guild);
                continue;
            }

            try {
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });
                console.log(`✅ [Voice] Rejoined channel ${channel.name} in ${guild.name}`);
            } catch (error) {
                console.error(`❌ [Voice] Failed to join ${channel.name}:`, error.message);
            }
        }
    } catch (e) {
        console.error("[Auto-Join] Error restoring voice connection:", e.message);
    }
};
