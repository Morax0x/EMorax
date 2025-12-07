const { Events, EmbedBuilder } = require("discord.js");
const { updateNickname } = require("../streak-handler.js"); 
const questsConfig = require('../json/quests-config.json');

// قائمة لمنع تكرار جائزة البوستر
const recentBoosters = new Set();

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const client = newMember.client;

        // 🔥🔥 التعديل: التحقق من أن قاعدة البيانات مفتوحة قبل البدء 🔥🔥
        if (!client.sql || !client.sql.open) return;

        const sql = client.sql;
        const guildID = newMember.guild.id;
        const userID = newMember.id;

        try {
            // 1. حماية الستريك (النك نيم)
            if (oldMember.nickname !== newMember.nickname) {
                const streakData = sql.prepare("SELECT * FROM streaks WHERE guildID = ? AND userID = ?").get(guildID, userID);
                if (streakData && streakData.nicknameActive === 1) {
                    await updateNickname(newMember, sql);
                }
            }

            // 2. إنجازات الرولات
            if (client.checkRoleAchievement) {
                await client.checkRoleAchievement(newMember, null, 'ach_race_role');
                const caesarRole = sql.prepare("SELECT roleID FROM quest_achievement_roles WHERE guildID = ? AND achievementID = ?").get(guildID, 'ach_caesar_role');
                if (caesarRole) await client.checkRoleAchievement(newMember, caesarRole.roleID, 'ach_caesar_role');
                const treeRole = sql.prepare("SELECT roleID FROM quest_achievement_roles WHERE guildID = ? AND achievementID = ?").get(guildID, 'ach_tree_role');
                if (treeRole) await client.checkRoleAchievement(newMember, treeRole.roleID, 'ach_tree_role');
                const tagRole = sql.prepare("SELECT roleID FROM quest_achievement_roles WHERE guildID = ? AND achievementID = ?").get(guildID, 'ach_tag_role');
                if (tagRole) await client.checkRoleAchievement(newMember, tagRole.roleID, 'ach_tag_role');
            }

            // 3. نظام البوست (Boost) - إصلاح التكرار
            const wasBoosting = oldMember.premiumSince;
            const isBoosting = newMember.premiumSince;

            if (!wasBoosting && isBoosting) {
                
                // 🛑 منع التكرار: اذا أخذ الجائزة قبل شوي نطلع
                if (recentBoosters.has(userID)) return;
                
                recentBoosters.add(userID);
                setTimeout(() => recentBoosters.delete(userID), 60000); // مدة الحماية دقيقة

                console.log(`[Boost Detected] ${newMember.user.tag} عزز السيرفر!`);

                const boostQuest = questsConfig.achievements.find(q => q.stat === 'boost_count');

                if (boostQuest) {
                    let levelData = client.getLevel.get(userID, guildID);
                    if (!levelData) levelData = { ...client.defaultData, user: userID, guild: guildID };

                    levelData.boost_count = (levelData.boost_count || 0) + 1;
                    levelData.mora = (levelData.mora || 0) + boostQuest.reward.mora;
                    levelData.xp += boostQuest.reward.xp;
                    levelData.totalXP += boostQuest.reward.xp;

                    const nextXP = 5 * (levelData.level ** 2) + (50 * levelData.level) + 100;
                    if (levelData.xp >= nextXP) {
                        const oldLevel = levelData.level;
                        levelData.xp -= nextXP;
                        levelData.level += 1;
                        const newLevel = levelData.level;
                        
                        if (client.sendLevelUpMessage) {
                             await client.sendLevelUpMessage(newMember, newMember, newLevel, oldLevel, levelData);
                        }
                    }

                    client.setLevel.run(levelData);

                    // إرسال رسالة الإنجاز
                    if (client.sendQuestAnnouncement) {
                        await client.sendQuestAnnouncement(newMember.guild, newMember, boostQuest, 'achievement');
                    }
                    
                    // إرسال شكر في الشات العام
                    const settings = sql.prepare("SELECT chatChannelID FROM settings WHERE guild = ?").get(guildID);
                    if (settings && settings.chatChannelID) {
                        const channel = newMember.guild.channels.cache.get(settings.chatChannelID);
                        if (channel) {
                            const embed = new EmbedBuilder()
                                .setTitle('🚀 بوستر جديد!')
                                .setDescription(`شـكـراً لـك ${newMember} عـلـى دعـم الـسـيـرفـر بـالـبـوسـت! ❤️\n\n**الـجـائـزة:**\n💰 ${boostQuest.reward.mora.toLocaleString()} مورا\n✨ ${boostQuest.reward.xp.toLocaleString()} XP`)
                                .setColor('#ff73fa')
                                .setImage('https://i.imgur.com/s160gP1.gif');
                            await channel.send({ content: `${newMember}`, embeds: [embed] });
                        }
                    }
                }
            }

        } catch (err) {
            console.error("[GuildMemberUpdate Error]", err);
        }
    },
};
