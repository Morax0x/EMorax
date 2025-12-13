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
const DUNGEON_COOLDOWN = 3 * 60 * 60 * 1000; // 3 ساعات بالملي ثانية

// صور الفوز والخسارة
const WIN_IMAGES = [
    'https://i.postimg.cc/JhMrnyLd/download-1.gif',
    'https://i.postimg.cc/FHgv29L0/download.gif',
    'https://i.postimg.cc/9MzjRZNy/haru-midoriya.gif',
    'https://i.postimg.cc/4ygk8q3G/tumblr-nmao11Zm-Bx1r3rdh2o2-500-gif-500-281.gif',
    'https://i.postimg.cc/pL6NNpdC/Epic7-Epic-Seven-GIF-Epic7-Epic-Seven-Tensura-Discover-Share-GIFs.gif',
    'https://i.postimg.cc/05dLktNF/download-5.gif',
    'https://i.postimg.cc/sXRVMwhZ/download-2.gif'
];

const LOSE_IMAGES = [
    'https://i.postimg.cc/xd8msjxk/escapar-a-toda-velocidad.gif',
    'https://i.postimg.cc/1zb8JGVC/download.gif',
    'https://i.postimg.cc/rmSwjvkV/download-1.gif',
    'https://i.postimg.cc/8PyPZRqt/download.jpg'
];

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

function getAllSkillData(sql, member) {
    const userRace = getUserRace(member, sql);
    const skillsOutput = {};
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

    // --- تحقق من الكولداون (3 ساعات) ---
    const lastRun = sql.prepare("SELECT last_dungeon FROM levels WHERE user = ? AND guild = ?").get(user.id, interaction.guild.id);
    if (lastRun && lastRun.last_dungeon) {
        const timeLeft = DUNGEON_COOLDOWN - (Date.now() - lastRun.last_dungeon);
        if (timeLeft > 0) {
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.reply({ 
                content: `⏳ أنت متعب جداً! يمكنك دخول الدانجون مجدداً بعد **${hours} ساعة و ${minutes} دقيقة**.`, 
                ephemeral: true 
            });
        }
    }

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
            
            // تحقق الكولداون للمنضمين أيضاً
            const joinerCD = sql.prepare("SELECT last_dungeon FROM levels WHERE user = ? AND guild = ?").get(i.user.id, i.guild.id);
            if (joinerCD && joinerCD.last_dungeon && (DUNGEON_COOLDOWN - (Date.now() - joinerCD.last_dungeon) > 0)) {
                return i.reply({ content: "❌ لا يمكنك الانضمام، أنت في وقت انتظار (Cooldown).", ephemeral: true });
            }

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
            // تحديث وقت الدخول (كولداون) وسحب المورا لجميع المشاركين
            party.forEach(id => {
                sql.prepare("UPDATE levels SET mora = mora - 100, last_dungeon = ? WHERE user = ? AND guild = ?").run(Date.now(), id, interaction.guild.id);
            });
            await runDungeon(interaction, party, theme, sql);
        } else {
            if (msg.editable) msg.edit({ content: "❌ تم الإلغاء.", components: [], embeds: [] });
        }
    });
}

function buildSkillSelector(player) {
    const userSkills = player.skills || {};
    const availableSkills = Object.values(userSkills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));
    
    if (availableSkills.length === 0) return null;

    const options = availableSkills.map(skill => {
        const cooldown = player.skillCooldowns[skill.id] || 0;
        const description = cooldown > 0 ? `🕓 كولداون: ${cooldown} جولات` : `⚡ القوة: ${skill.effectValue}`;
        return new StringSelectMenuOptionBuilder()
            .setLabel(skill.name)
            .setValue(skill.id)
            .setDescription(description)
            .setEmoji(skill.emoji || '✨');
    });

    const slicedOptions = options.slice(0, 25);

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('skill_select_menu')
            .setPlaceholder('اختر مهارة لاستخدامها...')
            .addOptions(slicedOptions)
    );
    return row;
}

// ⚔️⚔️ تشغيل الدانجون (المنطق الأساسي) ⚔️⚔️
async function runDungeon(interaction, partyIDs, theme, sql) {
    const channel = interaction.channel;
    const guild = interaction.guild;
    const hostId = partyIDs[0]; 
    
    let players = [];
    for (const id of partyIDs) {
        const m = await guild.members.fetch(id).catch(()=>null);
        if (m) players.push(getRealPlayerData(m, sql));
    }

    if (players.length === 0) return channel.send("❌ خطأ في البيانات.");

    let totalLoot = { mora: 0, xp: 0 };

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
            const collector = battleMsg.createMessageComponentCollector({ time: 60000 });
            let actedPlayers = [];

            await new Promise(resolve => {
                const turnTimeout = setTimeout(() => { collector.stop('turn_end'); }, 15000); 

                collector.on('collect', async i => {
                    const p = players.find(pl => pl.id === i.user.id);
                    if (!p || p.isDead || actedPlayers.includes(p.id)) {
                        if (!i.replied) await i.reply({ content: "⏳ انتظر الجولة القادمة.", ephemeral: true });
                        return;
                    }

                    if (i.customId === 'skill') {
                        const skillRow = buildSkillSelector(p);
                        if (!skillRow) return i.reply({ content: "❌ لا توجد مهارات.", ephemeral: true });
                        const skillMsg = await i.reply({ content: "✨ **اختر المهارة:**", components: [skillRow], ephemeral: true, fetchReply: true });
                        
                        try {
                            const selection = await skillMsg.awaitMessageComponent({ filter: subI => subI.user.id === i.user.id && subI.customId === 'skill_select_menu', time: 10000 });
                            const skillId = selection.values[0];
                            const skill = p.skills[skillId];

                            if ((p.skillCooldowns[skillId] || 0) > 0) return await selection.reply({ content: `⏳ كولداون (${p.skillCooldowns[skillId]}).`, ephemeral: true });

                            actedPlayers.push(p.id);
                            
                            let skillDmg = skill.stat_type.includes('%') ? Math.floor(p.atk * (1 + (skill.effectValue / 100))) : Math.floor(p.atk + skill.effectValue);

                            if (skill.name.includes("شفاء") || skill.name.includes("Heal")) {
                                const healAmount = Math.floor(p.maxHp * 0.3);
                                p.hp = Math.min(p.hp + healAmount, p.maxHp);
                                log.push(`✨ **${p.name}** استخدم ${skill.name} (+${healAmount} HP).`);
                            } else {
                                monster.hp -= skillDmg;
                                log.push(`💥 **${p.name}** استخدم ${skill.name} (**${skillDmg}** ضرر)!`);
                            }

                            p.skillCooldowns[skillId] = 3; 
                            await selection.update({ content: `✅ تم: ${skill.name}`, components: [] });
                            
                            if (actedPlayers.length >= players.filter(pl => !pl.isDead).length) { clearTimeout(turnTimeout); collector.stop('turn_end'); }

                        } catch (err) { await i.editReply({ content: "⏰ انتهى الوقت.", components: [] }); }
                        return;
                    }

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
                            log.push(`🧪 **${p.name}** شرب جرعة (+${heal} HP).`);
                        } else { log.push(`⚠️ **${p.name}** نفذت جرعاته!`); }
                    } 
                    else if (i.customId === 'def') {
                        p.defending = true;
                        log.push(`🛡️ **${p.name}** يدافع.`);
                    }

                    if (actedPlayers.length >= players.filter(pl => !pl.isDead).length) { clearTimeout(turnTimeout); collector.stop('turn_end'); }
                });

                collector.on('end', resolve);
            });

            players.forEach(p => { for (const sid in p.skillCooldowns) if (p.skillCooldowns[sid] > 0) p.skillCooldowns[sid]--; });

            if (monster.hp <= 0) {
                ongoing = false;
                await battleMsg.edit({ components: [] });

                const hostData = sql.prepare("SELECT dungeon_gate_level FROM levels WHERE user = ? AND guild = ?").get(hostId, guild.id);
                const gateLevel = hostData?.dungeon_gate_level || 1;
                const bonusMultiplier = 1 + ((gateLevel - 1) * 0.1);
                
                const floorXp = Math.floor(floorConfig.xp * bonusMultiplier);
                const floorMora = Math.floor(floorConfig.mora * bonusMultiplier);

                totalLoot.mora += floorMora;
                totalLoot.xp += floorXp;

                if (floor === 10) {
                    players.filter(p => !p.isDead).forEach(p => {
                        sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ? AND guild = ?").run(totalLoot.xp, totalLoot.mora, p.id, guild.id);
                        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guild.id, p.id, 15, Date.now() + 900000, 'xp', 0.15);
                        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guild.id, p.id, 15, Date.now() + 900000, 'mora', 0.15);
                        sql.prepare("UPDATE levels SET max_dungeon_floor = 10 WHERE user = ? AND guild = ?").run(p.id, guild.id);
                    });

                    const winEmbed = new EmbedBuilder()
                        .setTitle("🏆 أبطال الدانجون!")
                        .setDescription(`**تهانينا!** لقد قهرتم جميع الطوابق.\n\n💰 **مجموع الغنيمة:** ${totalLoot.mora.toLocaleString()} ${EMOJI_MORA}\n✨ **مجموع الخبرة:** ${totalLoot.xp} XP\n🎁 **المكافأة الكبرى:** Buff (+15% XP/Mora) لمدة 15 دقيقة!`)
                        .setColor('Gold')
                        .setImage(WIN_IMAGES[Math.floor(Math.random() * WIN_IMAGES.length)]);
                    
                    await channel.send({ embeds: [winEmbed] });
                    return; 
                }

                const decisionEmbed = new EmbedBuilder()
                    .setTitle(`🎉 تم القضاء على ${monster.name}!`)
                    .setColor(Colors.Blue)
                    .setDescription(`لقد حصلتم من هذا الطابق على:\n💰 **${floorMora}** مورا | ✨ **${floorXp}** XP\n\n📦 **إجمالي ما جمعتموه حتى الآن:**\n💰 **${totalLoot.mora.toLocaleString()}** مورا\n✨ **${totalLoot.xp.toLocaleString()}** XP\n\n❤️ **حالة الفريق:**\n${players.map(p => `${p.isDead ? '💀' : '💚'} ${p.name}: ${p.hp}/${p.maxHp}`).join('\n')}\n\n**هل تريدون الاستمرار للطابق التالي (مخاطرة) أم الانسحاب بالجوائز؟**`)
                    .setFooter({ text: 'القرار للقائد فقط' });

                const decisionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('dungeon_continue').setLabel('استمرار ⚔️').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('dungeon_retreat').setLabel('انسحاب 🏃‍♂️').setStyle(ButtonStyle.Secondary)
                );

                const decisionMsg = await channel.send({ embeds: [decisionEmbed], components: [decisionRow] });

                try {
                    const decision = await decisionMsg.awaitMessageComponent({ 
                        filter: i => i.user.id === hostId && (i.customId === 'dungeon_continue' || i.customId === 'dungeon_retreat'), 
                        time: 60000 
                    });

                    await decision.deferUpdate();

                    if (decision.customId === 'dungeon_retreat') {
                        players.filter(p => !p.isDead).forEach(p => {
                            sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ? AND guild = ?").run(totalLoot.xp, totalLoot.mora, p.id, guild.id);
                            const currentMax = sql.prepare("SELECT max_dungeon_floor FROM levels WHERE user = ? AND guild = ?").get(p.id, guild.id)?.max_dungeon_floor || 0;
                            if (floor > currentMax) sql.prepare("UPDATE levels SET max_dungeon_floor = ? WHERE user = ? AND guild = ?").run(floor, p.id, guild.id);
                        });

                        const retreatEmbed = new EmbedBuilder()
                            .setTitle("🏃‍♂️ انسحاب ناجح!")
                            .setDescription(`قرر الفريق الانسحاب والعودة بالغنائم.\n\n💰 **حصلتم على:** ${totalLoot.mora.toLocaleString()} ${EMOJI_MORA}\n✨ **حصلتم على:** ${totalLoot.xp.toLocaleString()} XP`)
                            .setColor('Green');
                        
                        await decisionMsg.edit({ embeds: [retreatEmbed], components: [] });
                        return; 
                    } else {
                        await decisionMsg.edit({ components: [] }); 
                        await channel.send("⚔️ **يتقدم الفريق نحو الظلام...**");
                        
                        players.forEach(p => { if(!p.isDead) p.hp = Math.min(p.hp + Math.floor(p.maxHp * 0.2), p.maxHp); p.defending = false; });
                        await new Promise(r => setTimeout(r, 2000));
                        continue; 
                    }

                } catch (e) {
                    players.filter(p => !p.isDead).forEach(p => {
                        sql.prepare("UPDATE levels SET xp = xp + ?, mora = mora + ? WHERE user = ? AND guild = ?").run(totalLoot.xp, totalLoot.mora, p.id, guild.id);
                    });
                    await decisionMsg.edit({ content: "⏰ انتهى الوقت، تم الانسحاب تلقائياً.", components: [] });
                    return;
                }
            }

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
                await battleMsg.edit({ components: [] });

                const expireTime = Date.now() + (15 * 60 * 1000);
                players.forEach(p => {
                    sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(guild.id, p.id, -15, expireTime, 'mora', -0.15);
                    sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(guild.id, p.id, 0, expireTime, 'pvp_wounded', 0);
                });

                const randomLoseImage = LOSE_IMAGES[Math.floor(Math.random() * LOSE_IMAGES.length)];
                const loseEmbed = new EmbedBuilder()
                    .setTitle("☠️ هُزم الفريق...")
                    .setDescription(`سقط جميع المغامرين في الطابق ${floor}.\n\n🚫 **فقدتم جميع الجوائز المجمعة!** (${totalLoot.mora} مورا)\n🩹 **العقوبة:** إصابة خطيرة (-15% كسب مورا) لمدة 15 دقيقة.`)
                    .setColor('DarkRed')
                    .setImage(randomLoseImage);

                let teamStatus = players.map(p => `${p.isDead ? '💀' : '🛡️'} ${p.name}`).join('\n');
                loseEmbed.addFields({ name: `🛡️ **حالة الفريق النهائية**`, value: teamStatus, inline: false });

                await channel.send({ embeds: [loseEmbed] });
                return;
            }

            players.forEach(p => p.defending = false);
            if (log.length > 5) log = log.slice(-5);
            await battleMsg.edit({ embeds: [generateBattleEmbed(players, monster, floor, theme, log)] });
        }
    }
}

function generateBattleEmbed(players, monster, floor, theme, log, color = '#2F3136') {
    const embed = new EmbedBuilder()
        .setTitle(`${theme.emoji} الطابق ${floor} | ضد ${monster.name}`)
        .setColor(color);

    const monsterBar = buildHpBar(monster.hp, monster.maxHp);
    embed.addFields({ 
        name: `👹 **${monster.name}** ${monster.enraged ? '🔥' : ''}`, 
        value: `${monsterBar} \`[${monster.hp}/${monster.maxHp}]\``, 
        inline: false 
    });

    let teamStatus = players.map(p => {
        const icon = p.isDead ? '💀' : (p.defending ? '🛡️' : '❤️');
        const hpBar = p.isDead ? 'MORT' : `\`${p.hp}/${p.maxHp}\``;
        return `${icon} **${p.name}**\n${hpBar} | ⚔️${p.atk}`;
    }).join('\n\n');

    embed.addFields({ name: `🛡️ **فريق المغامرين**`, value: teamStatus, inline: false });

    if (log.length > 0) {
        embed.addFields({ name: "📝 سجل المعركة:", value: log.join('\n'), inline: false });
    }

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
