const { Events } = require('discord.js');

// خريطة لتخزين بيانات الجلسات النشطة في الذاكرة
// المفتاح: UserID, القيمة: { joinTime, isStreaming, streamStartTime }
const voiceSessions = new Map();

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const client = newState.client;
        const member = newState.member;
        
        if (member.user.bot) return;

        const userID = member.id;
        const guildID = member.guild.id;
        const now = Date.now();

        // =================================================================
        // 1. معالجة الخروج أو الانتقال (حفظ الوقت السابق)
        // =================================================================
        // إذا كان العضو في روم سابقاً (وخرج الآن أو انتقل لروم آخر)
        if (oldState.channelId) {
            const session = voiceSessions.get(userID);
            
            // إذا كانت لديه جلسة مسجلة
            if (session) {
                // أ) حساب وقت الصوت
                const durationMs = now - session.joinTime;
                const minutes = Math.floor(durationMs / 60000);

                // ب) حساب وقت البث (إذا كان يبث أثناء الخروج)
                let streamMinutes = 0;
                if (session.isStreaming && session.streamStartTime) {
                    const streamDuration = now - session.streamStartTime;
                    streamMinutes = Math.floor(streamDuration / 60000);
                }

                // ج) الحفظ في قاعدة البيانات (فقط إذا مر دقيقة على الأقل)
                if (minutes >= 1 || streamMinutes >= 1) {
                    try {
                        // 1. تحديث جدول المستويات (XP & Mora & Total Time)
                        let userData = client.getLevel.get(userID, guildID);
                        if (!userData) userData = { ...client.defaultData, user: userID, guild: guildID };

                        if (minutes > 0) {
                            userData.totalVCTime = (userData.totalVCTime || 0) + minutes;
                            
                            // مكافأة: 5 XP و 2 Mora لكل دقيقة صوت
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

                        // 2. تحديث المهام والإحصائيات (Daily/Weekly/Achievements)
                        // نتأكد أن الدالة موجودة في الكلاينت قبل الاستدعاء
                        if (client.incrementQuestStats) {
                            if (minutes > 0) await client.incrementQuestStats(userID, guildID, 'vc_minutes', minutes);
                            if (streamMinutes > 0) await client.incrementQuestStats(userID, guildID, 'streaming_minutes', streamMinutes);
                        }

                        // console.log(`[Voice Saved] ${member.user.tag}: ${minutes}m Voice, ${streamMinutes}m Stream`);

                    } catch (err) {
                        console.error("[Voice Update Error]", err);
                    }
                }

                // حذف الجلسة القديمة لأنه خرج أو سينتقل لجلسة جديدة
                voiceSessions.delete(userID);
            }
        }

        // =================================================================
        // 2. معالجة الدخول أو الانتقال (بدء جلسة جديدة)
        // =================================================================
        // إذا دخل روم جديد (سواء كان قادماً من الخارج أو من روم آخر)
        if (newState.channelId) {
            // التحقق مما إذا كان يبث لحظة الدخول
            const isStreamingNow = newState.streaming;
            
            voiceSessions.set(userID, {
                joinTime: now,
                isStreaming: isStreamingNow,
                streamStartTime: isStreamingNow ? now : null
            });
        }

        // =================================================================
        // 3. معالجة تغيير حالة البث (تشغيل/إيقاف) أثناء التواجد في الروم
        // =================================================================
        // إذا كان في نفس الروم (لم يخرج ولم يدخل) ولكن تغيرت حالة الـ Streaming
        if (oldState.channelId === newState.channelId && oldState.channelId) {
            const session = voiceSessions.get(userID);
            if (session) {
                // أ) بدأ البث الآن
                if (!oldState.streaming && newState.streaming) {
                    session.isStreaming = true;
                    session.streamStartTime = now;
                    voiceSessions.set(userID, session); // تحديث
                }
                
                // ب) أوقف البث الآن
                else if (oldState.streaming && !newState.streaming) {
                    if (session.streamStartTime) {
                        const streamDuration = now - session.streamStartTime;
                        const streamMinutes = Math.floor(streamDuration / 60000);
                        
                        // حفظ دقائق البث فوراً
                        if (streamMinutes >= 1 && client.incrementQuestStats) {
                            await client.incrementQuestStats(userID, guildID, 'streaming_minutes', streamMinutes);
                            // console.log(`[Stream Saved] ${member.user.tag}: ${streamMinutes}m`);
                        }
                    }
                    // تصفير حالة البث في الجلسة الحالية
                    session.isStreaming = false;
                    session.streamStartTime = null;
                    voiceSessions.set(userID, session);
                }
            }
        }
    },
};
