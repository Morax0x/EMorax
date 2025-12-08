const { Events } = require('discord.js');

// خريطة لتخزين جلسات الصوت والبث
const voiceSessions = new Map();

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const client = newState.client;
        const member = newState.member;
        
        // تجاهل البوتات
        if (member.user.bot) return;

        const userID = member.id;
        const guildID = member.guild.id;
        const now = Date.now();

        // -------------------------------------------------------------
        // 1. عند المغادرة (Leave) أو الانتقال (Switch) -> إنهاء الجلسة وحساب الوقت
        // -------------------------------------------------------------
        if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
            if (voiceSessions.has(userID)) {
                const session = voiceSessions.get(userID);
                
                // أ) حساب مدة الصوت الكلية
                const durationMs = now - session.joinTime;
                const minutes = Math.floor(durationMs / 60000);

                // ب) حساب مدة البث (إذا كان يبث عند الخروج)
                let streamMinutes = 0;
                if (session.isStreaming && session.streamStartTime) {
                    const streamDuration = now - session.streamStartTime;
                    streamMinutes = Math.floor(streamDuration / 60000);
                }

                // ج) حفظ البيانات
                if (minutes >= 1 || streamMinutes >= 1) {
                    try {
                        // 1. تحديث جدول المستويات (XP & Mora & Total Time)
                        let userData = client.getLevel.get(userID, guildID);
                        if (!userData) userData = { ...client.defaultData, user: userID, guild: guildID };

                        if (minutes > 0) {
                            userData.totalVCTime = (userData.totalVCTime || 0) + minutes;
                            
                            // مكافأة: 5 XP و 2 Mora لكل دقيقة
                            const xpToAdd = minutes * 5;
                            const moraToAdd = minutes * 2;
                            
                            userData.xp += xpToAdd;
                            userData.totalXP += xpToAdd;
                            userData.mora += moraToAdd;

                            // فحص اللفل أب
                            const nextXP = 5 * (userData.level ** 2) + (50 * userData.level) + 100;
                            if (userData.xp >= nextXP) {
                                userData.xp -= nextXP;
                                userData.level++;
                            }
                        }
                        
                        client.setLevel.run(userData);

                        // 2. تحديث المهام والإحصائيات (Daily/Weekly)
                        if (client.incrementQuestStats) {
                            if (minutes > 0) await client.incrementQuestStats(userID, guildID, 'vc_minutes', minutes);
                            if (streamMinutes > 0) await client.incrementQuestStats(userID, guildID, 'streaming_minutes', streamMinutes);
                        }

                        console.log(`[Voice] ${member.user.tag}: +${minutes}m Voice, +${streamMinutes}m Stream`);

                    } catch (err) {
                        console.error("[Voice Update Error]", err);
                    }
                }

                // حذف الجلسة
                voiceSessions.delete(userID);
            }
        }

        // -------------------------------------------------------------
        // 2. عند الدخول (Join) -> بدء جلسة جديدة
        // -------------------------------------------------------------
        if (newState.channelId && !oldState.channelId) {
            voiceSessions.set(userID, {
                joinTime: now,
                isStreaming: newState.streaming,
                streamStartTime: newState.streaming ? now : null
            });
        }
        // حالة خاصة: إذا انتقل لروم آخر (Switch)، نبدأ جلسة جديدة فوراً
        else if (newState.channelId && oldState.channelId !== newState.channelId) {
            voiceSessions.set(userID, {
                joinTime: now,
                isStreaming: newState.streaming,
                streamStartTime: newState.streaming ? now : null
            });
        }

        // -------------------------------------------------------------
        // 3. تغيير حالة البث (Start/Stop Streaming) أثناء التواجد في الروم
        // -------------------------------------------------------------
        if (newState.channelId && oldState.channelId === newState.channelId) {
            if (voiceSessions.has(userID)) {
                const session = voiceSessions.get(userID);

                // أ) بدأ البث
                if (!oldState.streaming && newState.streaming) {
                    session.isStreaming = true;
                    session.streamStartTime = now;
                    voiceSessions.set(userID, session);
                }
                
                // ب) أوقف البث
                else if (oldState.streaming && !newState.streaming) {
                    if (session.streamStartTime) {
                        const streamDuration = now - session.streamStartTime;
                        const streamMinutes = Math.floor(streamDuration / 60000);
                        
                        // حفظ دقائق البث فوراً
                        if (streamMinutes > 0 && client.incrementQuestStats) {
                            await client.incrementQuestStats(userID, guildID, 'streaming_minutes', streamMinutes);
                            console.log(`[Stream] ${member.user.tag}: +${streamMinutes}m Stream (Stopped)`);
                        }
                    }
                    session.isStreaming = false;
                    session.streamStartTime = null;
                    voiceSessions.set(userID, session);
                }
            }
        }
    },
};
