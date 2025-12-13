const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, Colors } = require('discord.js');
const path = require('path');

// تحميل الإعدادات
const rootDir = process.cwd();
const dungeonConfig = require(path.join(rootDir, 'json', 'dungeon-config.json'));
const weaponsConfig = require(path.join(rootDir, 'json', 'weapons-config.json'));
const skillsConfig = require(path.join(rootDir, 'json', 'skills-config.json'));

// --- ثوابت النظام ---
const EMOJI_MORA = '<:mora:1435647151349698621>';
const BASE_HP = 100;
const HP_PER_LEVEL = 4;

// --- دوال مساعدة ---

function cleanDisplayName(name) {
    if (!name) return "لاعب";
    let clean = name.replace(/<a?:.+?:\d+>/g, '');
    clean = clean.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\DFFF]|\uD83D[\uDC00-\DFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\DFFF]/g, '');
    return clean.trim();
}

function buildHpBar(currentHp, maxHp) {
    currentHp = Math.max(0, currentHp);
    const percentage = (currentHp / maxHp) * 10;
    const filled = '█';
    const empty = '░';
    return `[${filled.repeat(Math.max(0, Math.floor(percentage))) + empty.repeat(Math.max(0, 10 - Math.floor(percentage)))}] ${currentHp}/${maxHp}`;
}

function getUserRace(member, sql) {
    if (!member || !member.guild) return null;
    const allRaceRoles = sql.prepare("SELECT roleID, raceName FROM race_roles WHERE guildID = ?").all(member.guild.id);
    if (!member.roles || !member.roles.cache) return null;
    const userRoleIDs = member.roles.cache.map(r => r.id);
    return allRaceRoles.find(r => userRoleIDs.includes(r.roleID)) || null;
}

// دالة جلب المهارات
function getAllSkillData(sql, member) {
    const userRace = getUserRace(member, sql);
    const skillsOutput = {};
    
    // 1. مهارات الداتابيس
    const userSkillsData = sql.prepare("SELECT * FROM user_skills WHERE userID = ? AND guildID = ?").all(member.id, member.guild.id);
    if (userSkillsData) {
        userSkillsData.forEach(userSkill => {
            const skillConfig = skillsConfig.find(s => s.id === userSkill.skillID);
            if (skillConfig && userSkill.skillLevel > 0) {
                const effectValue = skillConfig.base_value + (skillConfig.value_increment * (userSkill.skillLevel - 1));
                skillsOutput[skillConfig.id] = { ...skillConfig, currentLevel: userSkill.skillLevel, effectValue: effectValue };
            }
        });
    }

    // 2. مهارة العرق
    if (userRace) {
        const raceSkillId = `race_${userRace.raceName.toLowerCase().replace(/\s+/g, '_')}_skill`;
        const raceSkillConfig = skillsConfig.find(s => s.id === raceSkillId);
        if (raceSkillConfig && !skillsOutput[raceSkillId]) {
            skillsOutput[raceSkillId] = { ...raceSkillConfig, currentLevel: 1, effectValue: raceSkillConfig.base_value };
        }
    }
    return skillsOutput;
}

function getRealPlayerData(member, sql) {
    const guildID = member.guild.id;
    const userID = member.id;

    const userData = sql.prepare("SELECT level FROM levels WHERE user = ? AND guild = ?").get(userID, guildID);
    const level = userData ? userData.level : 1;
    const maxHp = BASE_HP + (level * HP_PER_LEVEL);

    let damage = 15;
    let weaponName = "قبضة اليد";
    const userRace = getUserRace(member, sql);
    if (userRace) {
        const weaponConfig = weaponsConfig.find(w => w.race === userRace.raceName);
        if (weaponConfig) {
            const userWeapon = sql.prepare("SELECT * FROM user_weapons WHERE userID = ? AND guildID = ? AND raceName = ?").get(userID, guildID, userRace.raceName);
            if (userWeapon && userWeapon.weaponLevel > 0) {
                damage = weaponConfig.base_damage + (weaponConfig.damage_increment * (userWeapon.weaponLevel - 1));
                weaponName = `${weaponConfig.name} (Lv.${userWeapon.weaponLevel})`;
            }
        }
    }

    return {
        id: userID,
        name: cleanDisplayName(member.displayName),
        avatar: member.user.displayAvatarURL(),
        level: level,
        hp: maxHp,
        maxHp: maxHp,
        atk: damage,
        weaponName: weaponName,
        skills: getAllSkillData(sql, member),
        isDead: false,
        defending: false,
        potions: 3,
        skillCooldowns: {}
    };
}

function getRandomMonster(type, theme) {
    let pool = [];
    if (type === 'boss') pool = dungeonConfig.monsters.bosses;
    else if (type === 'elite' || type === 'guardian') pool = dungeonConfig.monsters.elites;
    else pool = dungeonConfig.monsters.minions;
    const name = pool[Math.floor(Math.random() * pool.length)];
    return { name, emoji: theme.emoji };
}

// --- الهاندلر الرئيسي ---

async function startDungeon(interaction, sql) {
    const user = interaction.user;
    const themeOptions = Object.keys(dungeonConfig.themes).map(key => ({
        label: dungeonConfig.themes[key].name, value: key, emoji: dungeonConfig.themes[key].emoji
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('dungeon_theme').setPlaceholder('🌍 اختر عالم الدانجون...').addOptions(themeOptions)
    );

    const msg = await interaction.reply({ content: `👋 مرحباً **${user.username}**! اختر البوابة للدخول:`, components: [row], fetchReply: true });

    const filter = i => i.user.id === user.id && i.customId === 'dungeon_theme';
    try {
        const selection = await msg.awaitMessageComponent({ filter, time: 30000 });
        const themeKey = selection.values[0];
        const theme = dungeonConfig.themes[themeKey];
        await lobbyPhase(selection, theme, sql);
    } catch (e) {
        if (msg.editable) msg.edit({ content: "⏰ انتهى وقت الاختيار.", components: [] }).catch(()=>{});
    }
}

async function lobbyPhase(interaction, theme, sql) {
    const host = interaction.user;
    let party = [host.id];
    
    const updateEmbed = () => {
        const memberList = party.map((id, i) => `\`${i+1}.\` <@${id}> ${id === host.id ? '👑' : ''}`).join('\n');
        return new EmbedBuilder()
            .setTitle(`${theme.emoji} بوابة الدانجون: ${theme.name}`)
            .setDescription(`**القائد:** ${host}\n**التكلفة:** 💰 100 مورا\n\n👥 **المغامرون:**\n${memberList}`)
            .setColor('DarkRed')
            .setThumbnail(host.displayAvatarURL());
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join').setLabel('انضمام').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('start').setLabel('انطلاق').setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ content: null, embeds: [updateEmbed()], components: [row] });
    const msg = await interaction.message;
    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'join') {
            if (party.includes(i.user.id)) return i.reply({ content: "⚠️ أنت منضم بالفعل.", ephemeral: true });
            if (party.length >= 5) return i.reply({ content: "🚫 الفريق ممتلئ.", ephemeral: true });
            
            const userData = sql.prepare("SELECT mora FROM levels WHERE user = ?").get(i.user.id);
            if (!userData || userData.mora < 100) return i.reply({ content: "❌ ليس لديك 100 مورا.", ephemeral: true });
            
            party.push(i.user.id);
            await i.update({ embeds: [updateEmbed()] });
        } else if (i.customId === 'start') {
            if (i.user.id !== host.id) return i.reply({ content: "⛔ فقط القائد يمكنه البدء.", ephemeral: true });
            collector.stop('start');
        }
    });

    collector.on('end', async (c, reason) => {
        if (reason === 'start') {
            party.forEach(id => sql.prepare("UPDATE levels SET mora = mora - 100 WHERE user = ?").run(id));
            await runDungeon(interaction, party, theme, sql);
        } else {
            if (msg.editable) msg.edit({ content: "❌ تم الإلغاء.", components: [], embeds: [] });
        }
    });
}

// 🔥 دالة بناء قائمة المهارات (Dropdown) 🔥
function buildSkillSelector(player) {
    const userSkills = player.skills || {};
    const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));
    
    if (availableSkills.length === 0) return null;

    // استخدام Select Menu بدلاً من الأزرار لدعم عدد أكبر
    const options = availableSkills.map(skill => {
        const cooldown = player.skillCooldowns[skill.id] || 0;
        const description = cooldown > 0 ? `🕓 كولداون: ${cooldown} جولات` : `⚡ القوة: ${skill.effectValue}`;
        return new StringSelectMenuOptionBuilder()
            .setLabel(skill.name)
            .setValue(skill.id)
            .setDescription(description)
            .setEmoji(skill.emoji || '✨'); // لا يمكن تعطيل خيار فردي، سنتحقق لاحقاً
    });

    // تقطيع القائمة إذا زادت عن 25 (ديسكورد ليمت)
    const slicedOptions = options.slice(0, 25);

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('skill_select_menu')
            .setPlaceholder('اختر مهارة لاستخدامها...')
            .addOptions(slicedOptions)
    );
    return row;
}

async function runDungeon(interaction, partyIDs, theme, sql) {
    const channel = interaction.channel;
    const guild = interaction.guild;
    
    let players = [];
    for (const id of partyIDs) {
        const m = await guild.members.fetch(id).catch(()=>null);
        if (m) players.push(getRealPlayerData(m, sql));
    }

    if (players.length === 0) return channel.send("❌ خطأ في البيانات.");

    for (let floor = 1; floor <= 10; floor++) {
        if (players.every(p => p.isDead)) break;

        const floorConfig = dungeonConfig.floors.find(f => f.floor === floor) || dungeonConfig.floors[0];
        const randomMob = getRandomMonster(floorConfig.type, theme);
        const avgPlayerHp = players.reduce((sum, p) => sum + p.maxHp, 0) / players.length;
        
        let monster = {
            name: randomMob.name,
            hp: Math.floor(avgPlayerHp * floorConfig.hp_mult * (1 + (players.length * 0.2))),
            maxHp: Math.floor(avgPlayerHp * floorConfig.hp_mult * (1 + (players.length * 0.2))),
            atk: Math.floor(20 * floorConfig.atk_mult), 
            enraged: false
        };

        let log = [`⚠️ **الطابق ${floor}**: ظهر **${monster.name}**! (HP: ${monster.maxHp})`];
        let ongoing = true;

        const battleMsg = await channel.send({ 
            embeds: [generateBattleEmbed(players, monster, floor, theme, log)], 
            components: [generateBattleRow()] 
        });

        while (ongoing) {
            const collector = battleMsg.createMessageComponentCollector({ time: 60000 }); // وقت أطول قليلاً للاختيار
            let actedPlayers = [];

            await new Promise(resolve => {
                // مؤقت لإنهاء الجولة تلقائياً إذا تأخر الجميع
                const turnTimeout = setTimeout(() => {
                    collector.stop('turn_end');
                }, 15000); // 15 ثانية للجولة لتسريع اللعب

                collector.on('collect', async i => {
                    const p = players.find(pl => pl.id === i.user.id);
                    if (!p || p.isDead || actedPlayers.includes(p.id)) {
                        if (!i.replied) await i.reply({ content: "⏳ انتظر الجولة القادمة أو لست في المعركة.", ephemeral: true });
                        return;
                    }

                    // --- معالجة زر "المهارات" ---
                    if (i.customId === 'skill') {
                        const skillRow = buildSkillSelector(p);
                        if (!skillRow) return i.reply({ content: "❌ ليس لديك مهارات نشطة.", ephemeral: true });
                        
                        // نرسل القائمة كرسالة مخفية
                        const skillMsg = await i.reply({ content: "✨ **اختر المهارة:**", components: [skillRow], ephemeral: true, fetchReply: true });
                        
                        // انتظار اختيار المهارة
                        try {
                            const selection = await skillMsg.awaitMessageComponent({ 
                                filter: subI => subI.user.id === i.user.id && subI.customId === 'skill_select_menu', 
                                time: 10000 
                            });

                            const skillId = selection.values[0];
                            const skill = p.skills[skillId];

                            // التحقق من الكولداون
                            if ((p.skillCooldowns[skillId] || 0) > 0) {
                                return await selection.reply({ content: `⏳ المهارة في وضع الانتظار (${p.skillCooldowns[skillId]} جولات).`, ephemeral: true });
                            }

                            // تنفيذ المهارة
                            actedPlayers.push(p.id);
                            
                            let skillDmg = 0;
                            if (skill.stat_type.includes('%')) {
                                skillDmg = Math.floor(p.atk * (1 + (skill.effectValue / 100)));
                            } else {
                                skillDmg = Math.floor(p.atk + skill.effectValue);
                            }

                            if (skill.name.includes("شفاء") || skill.name.includes("Heal")) {
                                const healAmount = Math.floor(p.maxHp * 0.3); // شفاء 30%
                                p.hp = Math.min(p.hp + healAmount, p.maxHp);
                                log.push(`✨ **${p.name}** استخدم ${skill.name} وشفى نفسه (+${healAmount}).`);
                            } else {
                                monster.hp -= skillDmg;
                                log.push(`💥 **${p.name}** أطلق ${skill.name} وسبب **${skillDmg}** ضرر!`);
                            }

                            p.skillCooldowns[skillId] = 3; // تعيين الكولداون
                            await selection.update({ content: `✅ تم استخدام **${skill.name}**!`, components: [] });
                            
                            // إذا تحرك الجميع، ننهي الجولة فوراً
                            if (actedPlayers.length >= players.filter(pl => !pl.isDead).length) {
                                clearTimeout(turnTimeout);
                                collector.stop('turn_end');
                            }

                        } catch (err) {
                            // انتهى الوقت أو لم يختر شيئاً
                            await i.editReply({ content: "⏰ انتهى وقت اختيار المهارة.", components: [] });
                        }
                        return; // لا نكمل الكود بالأسفل لأننا عالجنا الدور
                    }

                    // --- باقي الأزرار (هجوم، علاج، دفاع) ---
                    actedPlayers.push(p.id);
                    await i.deferUpdate();

                    if (i.customId === 'atk') {
                        const isCrit = Math.random() < 0.2;
                        let dmg = Math.floor(p.atk * (0.9 + Math.random() * 0.2));
                        if (isCrit) dmg = Math.floor(dmg * 1.5);
                        monster.hp -= dmg;
                        log.push(`🗡️ **${p.name}** ${isCrit ? '**CRIT!**' : ''} سبب ${dmg} ضرر.`);
                    } 
                    else if (i.customId === 'heal') {
                        if (p.potions > 0) {
                            const heal = Math.floor(p.maxHp * 0.35);
                            p.hp = Math.min(p.hp + heal, p.maxHp);
                            p.potions--;
                            log.push(`🧪 **${p.name}** شرب جرعة (+${heal}).`);
                        } else {
                            log.push(`⚠️ **${p.name}** نفذت جرعاته!`);
                        }
                    } 
                    else if (i.customId === 'def') {
                        p.defending = true;
                        log.push(`🛡️ **${p.name}** يدافع.`);
                    }

                    // إذا تحرك الجميع، ننهي الجولة
                    if (actedPlayers.length >= players.filter(pl => !pl.isDead).length) {
                        clearTimeout(turnTimeout);
                        collector.stop('turn_end');
                    }
                });

                collector.on('end', resolve);
            });

            // تحديث الكولداون للمهارات
            players.forEach(p => {
                for (const sid in p.skillCooldowns) {
                    if (p.skillCooldowns[sid] > 0) p.skillCooldowns[sid]--;
                }
            });

            if (monster.hp <= 0) {
                ongoing = false;
                const hostData = sql.prepare("SELECT dungeon_gate_level FROM levels WHERE user = ?").get(partyIDs[0]);
                const gateLevel = hostData?.dungeon_gate_level || 1;
                const bonusMultiplier = 1 + ((gateLevel - 1) * 0.1);
                const xp = Math.floor(floorConfig.xp * bonusMultiplier);
                const mora = Math.floor(floorConfig.mora * bonusMultiplier);

                players.filter(p => !p.isDead).forEach(p => {
                    sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ?").run(xp, mora, p.id);
                    const currentMax = sql.prepare("SELECT max_dungeon_floor FROM levels WHERE user = ?").get(p.id)?.max_dungeon_floor || 0;
                    if (floor > currentMax) sql.prepare("UPDATE levels SET max_dungeon_floor = ? WHERE user = ?").run(floor, p.id);
                });

                log.push(`🎉 **هُزم الوحش!** (+${mora}💰 +${xp}XP)`);
                if (floor === 10) {
                    const winEmbed = new EmbedBuilder().setTitle("🏆 أبطال الدانجون!").setDescription(`**تهانينا!** لقد قهرتم جميع الطوابق.\n\n🎁 **المكافأة الكبرى:**\nتم تفعيل **Buff (+15% XP/Mora)** لمدة 15 دقيقة!`).setColor('Gold');
                    // تطبيق البف
                    const expireTime = Date.now() + (15 * 60 * 1000);
                    players.filter(p => !p.isDead).forEach(p => {
                        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guild.id, p.id, 15, expireTime, 'xp', 0.15);
                        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guild.id, p.id, 15, expireTime, 'mora', 0.15);
                    });
                    
                    await battleMsg.edit({ embeds: [winEmbed], components: [] });
                    return;
                }
                await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log, 'Green')], components: [] });
                players.forEach(p => { if(!p.isDead) p.hp = Math.min(p.hp + Math.floor(p.maxHp * 0.2), p.maxHp); p.defending = false; });
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }

            // هجوم الوحش (يحدث مرة واحدة بعد انتهاء وقت الجولة)
            const alivePlayers = players.filter(p => !p.isDead);
            if (alivePlayers.length > 0) {
                const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
                let dmg = monster.atk;
                let actionText = `👹 **${monster.name}** ضرب **${target.name}** بـ ${dmg} ضرر!`;
                if (Math.random() < 0.3) { dmg = Math.floor(dmg * 1.5); actionText = `🔥 **${monster.name}** هجوم ساحق على **${target.name}** (${dmg})!`; }
                if (target.defending) dmg = Math.floor(dmg * 0.5);
                target.hp -= dmg;
                log.push(actionText);
                if (target.hp <= 0) { target.hp = 0; target.isDead = true; log.push(`💀 **${target.name}** سقط!`); }
            }

            if (players.every(p => p.isDead)) {
                ongoing = false;
                const loseEmbed = new EmbedBuilder().setTitle("☠️ هُزم الفريق...").setDescription(`انتهت الرحلة في الطابق ${floor}.\n\n🩹 **العقوبة:** جرحى لمدة 15 دقيقة.`).setColor('DarkRed');
                // تطبيق عقوبة الخسارة
                const expireTime = Date.now() + (15 * 60 * 1000);
                players.forEach(p => {
                    sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(guild.id, p.id, -15, expireTime, 'mora', -0.15);
                    sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(guild.id, p.id, 0, expireTime, 'pvp_wounded', 0);
                });
                await battleMsg.edit({ embeds: [loseEmbed], components: [] });
                return;
            }

            players.forEach(p => p.defending = false);
            if (log.length > 6) log = log.slice(-6);
            await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log)] });
        }
    }
}

function generateBattleEmbed(players, monster, floor, theme, log, color = '#2F3136') {
    const embed = new EmbedBuilder().setTitle(`${theme.emoji} الطابق ${floor} | ضد ${monster.name}`).setColor(color);
    const monsterBar = buildHpBar(monster.hp, monster.maxHp);
    embed.addFields({ name: `👹 **${monster.name}**`, value: `${monsterBar} \`[${monster.hp}/${monster.maxHp}]\``, inline: false });
    let teamStatus = players.map(p => {
        const icon = p.isDead ? '💀' : (p.defending ? '🛡️' : '❤️');
        const hpBar = p.isDead ? 'MORT' : `\`${p.hp}/${p.maxHp}\``;
        return `${icon} **${p.name}**\n${hpBar} | ⚔️${p.atk}`;
    }).join('\n\n');
    embed.addFields({ name: `🛡️ **فريق المغامرين**`, value: teamStatus, inline: false });
    embed.setDescription(`\`\`\`diff\n${log.join('\n')}\n\`\`\``);
    return embed;
}

function generateBattleRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('atk').setLabel('هجوم').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('skill').setLabel('مهارات').setEmoji('✨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('heal').setLabel('جرعة').setEmoji('🧪').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('def').setLabel('دفاع').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)
    );
}

module.exports = { startDungeon };
