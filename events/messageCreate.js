const { Events, PermissionsBitField, Collection } = require("discord.js");
const { handleStreakMessage, handleMediaStreakMessage, calculateBuffMultiplier } = require("../streak-handler.js");
const { checkPermissions, checkCooldown } = require("../permission-handler.js");
const { processReportLogic, sendReportError } = require("../handlers/report-handler.js");

const DISBOARD_BOT_ID = '302050872383242240'; 

const autoResponderCooldowns = new Collection();
const treeCooldowns = new Set();

function getTodayDateString() { return new Date().toISOString().split('T')[0]; }
function getWeekStartDateString() {
    const now = new Date(); const diff = now.getUTCDate() - (now.getUTCDay() + 2) % 7; 
    const friday = new Date(now.setUTCDate(diff)); friday.setUTCHours(0, 0, 0, 0); return friday.toISOString().split('T')[0];
}

async function recordBump(client, guildID, userID) {
    const sql = client.sql;
    if (!sql || !sql.open) return;

    const dateStr = getTodayDateString();
    const weekStr = getWeekStartDateString();
    const dailyID = `${userID}-${guildID}-${dateStr}`;
    const weeklyID = `${userID}-${guildID}-${weekStr}`;
    const totalID = `${userID}-${guildID}`;

    try {
        sql.prepare(`INSERT INTO user_daily_stats (id, userID, guildID, date, disboard_bumps) VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET disboard_bumps = disboard_bumps + 1`).run(dailyID, userID, guildID, dateStr);
        sql.prepare(`INSERT INTO user_weekly_stats (id, userID, guildID, weekStartDate, disboard_bumps) VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET disboard_bumps = disboard_bumps + 1`).run(weeklyID, userID, guildID, weekStr);
        sql.prepare(`INSERT INTO user_total_stats (id, userID, guildID, total_disboard_bumps) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET total_disboard_bumps = total_disboard_bumps + 1`).run(totalID, userID, guildID);

        const member = await client.guilds.cache.get(guildID)?.members.fetch(userID).catch(() => null);
        if (member && client.checkQuests) {
            const updatedDaily = sql.prepare("SELECT * FROM user_daily_stats WHERE id = ?").get(dailyID);
            const updatedTotal = sql.prepare("SELECT * FROM user_total_stats WHERE id = ?").get(totalID);
            if (updatedDaily) await client.checkQuests(client, member, updatedDaily, 'daily', dateStr);
            if (updatedTotal) await client.checkAchievements(client, member, null, updatedTotal);
        }
    } catch (e) { console.error(e); }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        const client = message.client;
        const sql = client.sql;

        if (!sql || !sql.open) return;
        if (!message.guild) return;

        if (message.author.id === DISBOARD_BOT_ID) {
            let bumperID = null;
            if (message.interaction && message.interaction.commandName === 'bump') {
                bumperID = message.interaction.user.id;
            } else if (message.embeds.length > 0) {
                const desc = message.embeds[0].description || "";
                if (desc.includes('Bump done') || desc.includes('Bump successful') || desc.includes('بومب')) {
                    const match = desc.match(/<@!?(\d+)>/); 
                    if (match && match[1]) bumperID = match[1];
                }
            }
            if (bumperID) {
                await recordBump(client, message.guild.id, bumperID);
                await message.react('👊').catch(() => {});
            }
            return; 
        }

        let settings = sql.prepare("SELECT * FROM settings WHERE guild = ?").get(message.guild.id);

        if (settings && settings.treeChannelID && message.channel.id === settings.treeChannelID) {
            if (message.author.bot) {
                const fullContent = (message.content || "") + " " + (message.embeds[0]?.description || "") + " " + (message.embeds[0]?.title || "");
                const lowerContent = fullContent.toLowerCase();
                const validPhrases = ["watered the tree", "سقى الشجرة", "has watered", "قام بسقاية"];
                
                if (validPhrases.some(p => lowerContent.includes(p))) {
                    const match = fullContent.match(/<@!?(\d+)>/);
                    if (match && match[1]) {
                        const userID = match[1];
                        if (userID !== client.user.id && !treeCooldowns.has(userID)) {
                            treeCooldowns.add(userID);
                            setTimeout(() => treeCooldowns.delete(userID), 60000);
                            if (client.incrementQuestStats) {
                                await client.incrementQuestStats(userID, message.guild.id, 'water_tree', 1);
                                message.react('💧').catch(() => {});
                            }
                        }
                    }
                }
            }
        }

        if (message.author.bot) return;

        let reportSettings = sql.prepare("SELECT reportChannelID FROM report_settings WHERE guildID = ?").get(message.guild.id);

        try {
            const argsRaw = message.content.trim().split(/ +/);
            const shortcutWord = argsRaw[0].toLowerCase().trim();
            let targetName = null;

            const potentialShortcuts = sql.prepare(`
                SELECT commandName, channelID 
                FROM command_shortcuts 
                WHERE guildID = ? AND shortcutWord = ?
            `).all(message.guild.id, shortcutWord);

            if (potentialShortcuts.length > 0) {
                const exactChannel = potentialShortcuts.find(s => s.channelID === message.channel.id);
                
                let categoryChannel = null;
                if (message.channel.parentId) {
                    categoryChannel = potentialShortcuts.find(s => s.channelID === message.channel.parentId);
                }

                const globalShortcut = potentialShortcuts.find(s => !s.channelID || s.channelID === '' || s.channelID === 'null');

                if (exactChannel) {
                    targetName = exactChannel.commandName;
                } else if (categoryChannel) {
                    targetName = categoryChannel.commandName;
                } else if (globalShortcut) {
                    targetName = globalShortcut.commandName;
                }

                if (targetName) {
                    targetName = targetName.replace(/^-/, '').toLowerCase().trim();
                }
            }

            if (targetName) {
                const findCmd = (name) => {
                    const n = name.toLowerCase();
                    return client.commands.get(n) || 
                           client.commands.find(c => c.name && c.name.toLowerCase() === n) ||
                           client.commands.find(c => c.aliases && c.aliases.includes(n)) ||
                           client.commands.find(c => c.data && c.data.name && c.data.name.toLowerCase() === n);
                };

                const cmd = findCmd(targetName);

                if (cmd) {
                    let isAllowed = false;
                    
                    if (message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) isAllowed = true;
                    else if (settings && settings.casinoChannelID === message.channel.id && cmd.category === 'Economy') isAllowed = true;
                    else {
                        const channelPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(message.guild.id, cmd.name, message.channel.id);
                        const categoryPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(message.guild.id, cmd.name, message.channel.parentId);
                        if (channelPerm || categoryPerm) isAllowed = true;
                        else {
                             const isRestricted = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? LIMIT 1").get(message.guild.id, cmd.name);
                             if (!isRestricted) isAllowed = true;
                        }
                    }
                    
                    if (isAllowed) {
                        if (checkPermissions(message, cmd)) {
                            const cooldownMsg = checkCooldown(message, cmd);
                            if (cooldownMsg) {
                                if (typeof cooldownMsg === 'string') message.reply(cooldownMsg);
                                return;
                            }
                            try {
                                const finalArgs = argsRaw.slice(1);
                                finalArgs.prefix = ""; 
                                await cmd.execute(message, finalArgs); 
                            } catch (e) { console.error(`[Shortcut Exec Error]`, e); }
                        }
                    }
                    return; 
                }
            }
        } catch (err) { console.error("[Shortcut Handler Error]", err); }

        let Prefix = "-";
        try { const row = sql.prepare("SELECT serverprefix FROM prefix WHERE guild = ?").get(message.guild.id); if (row && row.serverprefix) Prefix = row.serverprefix; } catch(e) {}

        if (message.content.startsWith(Prefix)) {
            const args = message.content.slice(Prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            
            const findCmd = (name) => {
                const n = name.toLowerCase();
                return client.commands.get(n) || 
                       client.commands.find(c => c.name && c.name.toLowerCase() === n) ||
                       client.commands.find(c => c.aliases && c.aliases.includes(n)) ||
                       client.commands.find(c => c.data && c.data.name && c.data.name.toLowerCase() === n);
            };

            const command = findCmd(commandName);
            
            if (command) {
                args.prefix = Prefix;
                
                let isAllowed = false;
                
                if (message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) isAllowed = true;
                else if (settings && settings.casinoChannelID === message.channel.id && command.category === 'Economy') isAllowed = true;
                else {
                    try {
                        const channelPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(message.guild.id, command.name, message.channel.id);
                        const categoryPerm = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? AND channelID = ?").get(message.guild.id, command.name, message.channel.parentId);
                        
                        if (channelPerm || categoryPerm) isAllowed = true;
                        else { 
                            const hasRestrictions = sql.prepare("SELECT 1 FROM command_permissions WHERE guildID = ? AND commandName = ? LIMIT 1").get(message.guild.id, command.name);
                            if (!hasRestrictions) isAllowed = true; 
                        }
                    } catch (err) { isAllowed = true; }
                }

                if (isAllowed) {
                    if (checkPermissions(message, command)) {
                        const cooldownMsg = checkCooldown(message, command);
                        if (cooldownMsg) { if (typeof cooldownMsg === 'string') message.reply(cooldownMsg); } 
                        else { try { await command.execute(message, args); } catch (error) { console.error(error); message.reply("Error"); } }
                    }
                }
                return;
            }
        }

        if (reportSettings && reportSettings.reportChannelID && message.channel.id === reportSettings.reportChannelID) {
            if (message.content.trim().startsWith("بلاغ")) {
                const args = message.content.trim().split(/ +/); args.shift(); await message.delete().catch(() => {});
                const allowedRoles = sql.prepare("SELECT roleID FROM report_permissions WHERE guildID = ?").all(message.guild.id).map(r => r.roleID);
                const hasPerm = message.member.permissions.has(PermissionsBitField.Flags.Administrator) || allowedRoles.length === 0 || message.member.roles.cache.some(r => allowedRoles.includes(r.id));
                if (!hasPerm) return sendReportError(message, "❖ ليس لـديـك صلاحيـات", "ليس لديك صلاحيات التبليغ.");
                const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
                const reason = args.slice(1).join(" ");
                if (!target || !reason) return sendReportError(message, "✶ خطأ في التنسيق", "`بلاغ @user السبب`");
                await processReportLogic(client, message, target, reason);
            }
            return; 
        }

        if (settings && settings.casinoChannelID && message.channel.id === settings.casinoChannelID) {
            const args = message.content.trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            
            const findCmd = (name) => {
                const n = name.toLowerCase();
                return client.commands.get(n) || 
                       client.commands.find(c => c.name && c.name.toLowerCase() === n) ||
                       client.commands.find(c => c.aliases && c.aliases.includes(n)) ||
                       client.commands.find(c => c.data && c.data.name && c.data.name.toLowerCase() === n);
            };

            const command = findCmd(commandName);

            if (command && command.category === "Economy") {
                if (!checkPermissions(message, command)) return;
                try { await command.execute(message, args); } catch (error) {}
            }
            return;
        }

        try {
            let blacklist = sql.prepare(`SELECT id FROM blacklistTable WHERE id = ?`);
            if (blacklist.get(`${message.guild.id}-${message.author.id}`) || blacklist.get(`${message.guild.id}-${message.channel.id}`)) return;
        } catch (e) {}

        try {
            const autoResponses = sql.prepare("SELECT * FROM auto_responses WHERE guildID = ?").all(message.guild.id);
            const content = message.content.trim().toLowerCase();

            for (const ar of autoResponses) {
                let isMatch = false;
                const trigger = ar.trigger.trim().toLowerCase();
                if (ar.matchType === 'contains') { if (content.includes(trigger)) isMatch = true; } 
                else { if (content === trigger) isMatch = true; }

                if (isMatch) {
                    const allowed = ar.allowedChannels ? JSON.parse(ar.allowedChannels) : [];
                    const ignored = ar.ignoredChannels ? JSON.parse(ar.ignoredChannels) : [];
                    if (allowed.length > 0 && !allowed.includes(message.channel.id)) continue;
                    if (ignored.includes(message.channel.id)) continue;

                    if (message.author.id !== message.guild.ownerId) {
                        const key = `${message.guild.id}-${ar.id}-${message.author.id}`;
                        const now = Date.now();
                        const expirationTime = autoResponderCooldowns.get(key);
                        if (expirationTime && now < expirationTime) continue; 
                        if (ar.cooldown > 0) {
                            autoResponderCooldowns.set(key, now + (ar.cooldown * 1000));
                            setTimeout(() => autoResponderCooldowns.delete(key), ar.cooldown * 1000);
                        }
                    }

                    let responses = [];
                    try { responses = JSON.parse(ar.response); } catch (e) { responses = [ar.response]; }
                    let images = [];
                    try { images = ar.images ? JSON.parse(ar.images) : []; } catch(e) {}
                    
                    const randomText = responses[Math.floor(Math.random() * responses.length)];
                    const randomImage = images.length > 0 ? images[Math.floor(Math.random() * images.length)] : null;

                    const payload = { content: randomText, allowedMentions: { repliedUser: false } };
                    if (randomImage) payload.files = [randomImage];
                    
                    await message.reply(payload).catch(() => {});
                    break; 
                }
            }
        } catch (err) { console.error("[Auto Responder Error]", err); }

        try {
            const userID = message.author.id;
            const guildID = message.guild.id;

            if (client.incrementQuestStats) {
                await client.incrementQuestStats(userID, guildID, 'messages', 1);
                if (message.attachments.size > 0) await client.incrementQuestStats(userID, guildID, 'images', 1);
                if (message.stickers.size > 0) await client.incrementQuestStats(userID, guildID, 'stickers', message.stickers.size);
                
                const emojiRegex = /<a?:\w+:\d+>|[\u{1F300}-\u{1F9FF}]/gu;
                const emojis = message.content.match(emojiRegex);
                if (emojis) {
                    await client.incrementQuestStats(userID, guildID, 'emojis_sent', emojis.length);
                }
            }

            if (message.mentions.users.size > 0) {
                message.mentions.users.forEach(async (user) => {
                    if (user.id !== message.author.id && !user.bot) {
                        if (client.incrementQuestStats) await client.incrementQuestStats(user.id, guildID, 'mentions_received', 1);
                    }
                });
            }
            if (message.reference && message.reference.messageId) {
                try {
                    const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (repliedMsg && repliedMsg.author.id !== message.author.id) {
                        if (client.incrementQuestStats) await client.incrementQuestStats(userID, guildID, 'replies_sent', 1);
                    }
                } catch(e) {}
            }
            if (settings && settings.countingChannelID && message.channel.id === settings.countingChannelID) {
                if (!isNaN(message.content.trim())) {
                    if (client.incrementQuestStats) await client.incrementQuestStats(userID, guildID, 'counting_channel', 1);
                }
            }
            if (message.content.toLowerCase().includes('مياو') || message.content.toLowerCase().includes('meow')) {
                if (client.incrementQuestStats) await client.incrementQuestStats(userID, guildID, 'meow_count', 1);
                let level = client.getLevel.get(userID, guildID);
                if (level) {
                     level.total_meow_count = (level.total_meow_count || 0) + 1;
                     client.setLevel.run(level);
                     if (client.checkAchievements) await client.checkAchievements(client, message.member, level, null);
                }
            }
            const isMediaChannel = sql.prepare("SELECT * FROM media_streak_channels WHERE guildID = ? AND channelID = ?").get(guildID, message.channel.id);
            if (isMediaChannel) {
                if (message.attachments.size > 0 || message.content.includes('http')) {
                    await handleMediaStreakMessage(message);
                    return; 
                }
            }
        } catch (err) {}

        await handleStreakMessage(message);
        
        let level = client.getLevel.get(message.author.id, message.guild.id);
        const completeDefaultLevelData = { xp: 0, level: 1, totalXP: 0, mora: 0, lastWork: 0, lastDaily: 0, dailyStreak: 0, bank: 0, lastInterest: 0, totalInterestEarned: 0, hasGuard: 0, guardExpires: 0, lastCollected: 0, totalVCTime: 0, lastRob: 0, lastGuess: 0, lastRPS: 0, lastRoulette: 0, lastTransfer: 0, lastDeposit: 0, shop_purchases: 0, total_meow_count: 0, boost_count: 0, lastPVP: 0 };
        if (!level) level = { ...(client.defaultData || {}), ...completeDefaultLevelData, user: message.author.id, guild: message.guild.id };
        
        let getXpfromDB = settings?.customXP || 25;
        let getCooldownfromDB = settings?.customCooldown || 60000;

        if (!client.talkedRecently.get(message.author.id)) {
            const buff = calculateBuffMultiplier(message.member, sql);
            const xp = Math.floor((Math.random() * getXpfromDB + 1) * buff);
            level.xp += xp; level.totalXP += xp;
            const nextXP = 5 * (level.level ** 2) + (50 * level.level) + 100;
            if (level.xp >= nextXP) {
                level.xp -= nextXP; level.level++;
                if(client.sendLevelUpMessage) await client.sendLevelUpMessage(message, message.member, level.level, level.level-1, level);
            }
            client.setLevel.run(level);
            client.talkedRecently.set(message.author.id, Date.now() + getCooldownfromDB);
            setTimeout(() => client.talkedRecently.delete(message.author.id), getCooldownfromDB);
        }
        
        try {
            let Roles = sql.prepare("SELECT * FROM level_roles WHERE guildID = ? AND level = ?").get(message.guild.id, level.level);
            if (Roles && message.member && !message.member.roles.cache.has(Roles.roleID)) {
                message.member.roles.add(Roles.roleID).catch(e => {});
            }
        } catch (e) {}
    },
};
