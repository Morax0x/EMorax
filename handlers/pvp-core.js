const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, ComponentType } = require("discord.js");
const path = require('path');

const rootDir = process.cwd();
const weaponsConfig = require(path.join(rootDir, 'json', 'weapons-config.json'));
const skillsConfig = require(path.join(rootDir, 'json', 'skills-config.json'));

const EMOJI_MORA = '<:mora:1435647151349698621>';
const BASE_HP = 100;
const HP_PER_LEVEL = 4;
const SKILL_COOLDOWN_TURNS = 3;

// --- صور النتائج (نفس PvP) ---
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

// القوائم
const activePvpChallenges = new Set();
const activePvpBattles = new Map();
const activePveBattles = new Map();

// --- الدوال المساعدة ---

function cleanDisplayName(name) {
    if (!name) return "لاعب";
    let clean = name.replace(/<a?:.+?:\d+>/g, '');
    clean = clean.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\DFFF]|\uD83D[\uDC00-\DFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\DFFF]/g, '');
    clean = clean.replace(/\s*[|・•»✦]\s*\d+\s* ?🔥/g, '');
    return clean.trim();
}

function getUserRace(member, sql) {
    if (!member || !member.guild) return null;
    const allRaceRoles = sql.prepare("SELECT roleID, raceName FROM race_roles WHERE guildID = ?").all(member.guild.id);
    if (!member.roles || !member.roles.cache) return null;
    const userRoleIDs = member.roles.cache.map(r => r.id);
    return allRaceRoles.find(r => userRoleIDs.includes(r.roleID)) || null;
}

function getWeaponData(sql, member) {
    const userRace = getUserRace(member, sql);
    if (!userRace) return null;
    const weaponConfig = weaponsConfig.find(w => w.race === userRace.raceName);
    if (!weaponConfig) return null;
    let userWeapon = sql.prepare("SELECT * FROM user_weapons WHERE userID = ? AND guildID = ? AND raceName = ?").get(member.id, member.guild.id, userRace.raceName);
    let weaponLevel = userWeapon ? userWeapon.weaponLevel : 0;
    if (weaponLevel === 0) return null;
    const damage = weaponConfig.base_damage + (weaponConfig.damage_increment * (weaponLevel - 1));
    return { ...weaponConfig, currentDamage: damage, currentLevel: weaponLevel };
}

function getAllSkillData(sql, member) {
    const userRace = getUserRace(member, sql);
    const userSkillsData = sql.prepare("SELECT * FROM user_skills WHERE userID = ? AND guildID = ?").all(member.id, member.guild.id);
    if (!userSkillsData && !userRace) return {};
    const skillsOutput = {};
    userSkillsData.forEach(userSkill => {
        const skillConfig = skillsConfig.find(s => s.id === userSkill.skillID);
        if (skillConfig && userSkill.skillLevel > 0) {
            const skillLevel = userSkill.skillLevel;
            const effectValue = skillConfig.base_value + (skillConfig.value_increment * (skillLevel - 1));
            skillsOutput[skillConfig.id] = { ...skillConfig, currentLevel: skillLevel, effectValue: effectValue };
        }
    });
    if (userRace) {
        const raceSkillId = `race_${userRace.raceName.toLowerCase().replace(' ', '_')}_skill`;
        if (!skillsOutput[raceSkillId]) {
            const skillConfig = skillsConfig.find(s => s.id === raceSkillId);
            if (skillConfig) skillsOutput[raceSkillId] = { ...skillConfig, currentLevel: 0, effectValue: 0 };
        }
    }
    return skillsOutput;
}

async function getUserActiveSkill(sql, userId, guildId) {
    const userSkills = sql.prepare("SELECT * FROM user_skills WHERE userID = ? AND guildID = ?").all(userId, guildId);
    if (userSkills.length > 0) {
        const randomSkillData = userSkills[Math.floor(Math.random() * userSkills.length)];
        const skillConfig = skillsConfig.find(s => s.id === randomSkillData.skillID);
        if (skillConfig) {
            const level = randomSkillData.skillLevel;
            const power = skillConfig.base_value + (skillConfig.value_increment * (level - 1));
            return { name: skillConfig.name, level: level, damage: power };
        }
    }
    return null;
}

// --- بناء الواجهة ---

function buildHpBar(currentHp, maxHp) {
    currentHp = Math.max(0, currentHp);
    const percentage = (currentHp / maxHp) * 10;
    const filled = '█';
    const empty = '░';
    return `[${filled.repeat(Math.max(0, Math.floor(percentage))) + empty.repeat(Math.max(0, 10 - Math.floor(percentage)))}] ${currentHp}/${maxHp}`;
}

function buildSkillButtons(battleState, attackerId, page = 0) {
    const attacker = battleState.players.get(attackerId);
    if (attacker.isMonster) return []; 

    const cooldowns = battleState.skillCooldowns[attackerId];
    const availableSkills = Object.values(attacker.skills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

    const skillsPerPage = 4;
    const totalPages = Math.ceil(availableSkills.length / skillsPerPage);
    page = Math.max(0, Math.min(page, totalPages - 1));
    battleState.skillPage = page;

    const skillsToShow = availableSkills.slice(page * skillsPerPage, (page * skillsPerPage) + skillsPerPage);
    const skillButtons = new ActionRowBuilder();
    
    skillsToShow.forEach(skill => {
        skillButtons.addComponents(new ButtonBuilder().setCustomId(`pvp_skill_use_${skill.id}`).setLabel(`${skill.name}`).setEmoji(skill.emoji).setStyle(ButtonStyle.Primary).setDisabled((cooldowns[skill.id] || 0) > 0));
    });

    const navigationButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pvp_skill_back').setLabel('العودة').setStyle(ButtonStyle.Secondary));
    if (totalPages > 1) {
        navigationButtons.addComponents(
            new ButtonBuilder().setCustomId(`pvp_skill_page_${page - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`pvp_skill_page_${page + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
        );
    }
    return [skillButtons, navigationButtons].filter(row => row.components.length > 0);
}

function buildEffectsString(effects) {
    let arr = [];
    if (effects.shield > 0) arr.push(`🛡️ (${effects.shield})`);
    if (effects.buff > 0) arr.push(`💪 (${effects.buff})`);
    if (effects.weaken > 0) arr.push(`📉 (${effects.weaken})`);
    if (effects.poison > 0) arr.push(`☠️ (${effects.poison})`);
    return arr.length > 0 ? arr.join(' ') : 'لا يوجد';
}

function buildBattleEmbed(battleState, skillSelectionMode = false, skillPage = 0) {
    const [attackerId, defenderId] = battleState.turn;
    const attacker = battleState.players.get(attackerId);
    const defender = battleState.players.get(defenderId);
    const attackerName = attacker.isMonster ? attacker.name : cleanDisplayName(attacker.member.user.displayName);
    const defenderName = defender.isMonster ? defender.name : cleanDisplayName(defender.member.user.displayName);

    const embed = new EmbedBuilder().setTitle(`⚔️ ${attackerName} 🆚 ${defenderName} ⚔️`).setColor(Colors.Red);
    embed.addFields(
        { name: `${attackerName}`, value: `HP: ${buildHpBar(attacker.hp, attacker.maxHp)}\nتأثيرات: ${buildEffectsString(attacker.effects)}`, inline: true },
        { name: `${defenderName}`, value: `HP: ${buildHpBar(defender.hp, defender.maxHp)}\nتأثيرات: ${buildEffectsString(defender.effects)}`, inline: true }
    );

    if (battleState.isPvE) {
        embed.setDescription(`🦑 **معركة ضد وحش!**\nالدور الآن لـ: **${attackerName}**`);
    } else {
        embed.setDescription(`الرهان: **${(battleState.bet * 2).toLocaleString()}** ${EMOJI_MORA}\n\n**الدور الآن لـ:** ${attacker.member}`);
    }

    if (battleState.log.length > 0) embed.addFields({ name: "📝 السجل:", value: battleState.log.slice(-3).join('\n'), inline: false });

    if (attacker.isMonster) return { embeds: [embed], components: [] };

    if (skillSelectionMode) {
        return { embeds: [embed], components: buildSkillButtons(battleState, attackerId, skillPage) };
    }

    const mainButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pvp_action_attack').setLabel('هجوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
        new ButtonBuilder().setCustomId('pvp_action_skill').setLabel('مهارات').setStyle(ButtonStyle.Primary).setEmoji('✨'),
        new ButtonBuilder().setCustomId('pvp_action_forfeit').setLabel('هروب').setStyle(ButtonStyle.Secondary).setEmoji('🏳️')
    );
    return { embeds: [embed], components: [mainButtons] };
}

// --- بدء المعارك ---

async function startPvpBattle(i, client, sql, challengerMember, opponentMember, bet) {
    const getLevel = i.client.getLevel;
    const setLevel = i.client.setLevel;
    let challengerData = getLevel.get(challengerMember.id, i.guild.id) || { ...client.defaultData, user: challengerMember.id, guild: i.guild.id };
    let opponentData = getLevel.get(opponentMember.id, i.guild.id) || { ...client.defaultData, user: opponentMember.id, guild: i.guild.id };
    challengerData.mora -= bet; opponentData.mora -= bet;
    setLevel.run(challengerData); setLevel.run(opponentData);
    
    const challengerMaxHp = BASE_HP + (challengerData.level * HP_PER_LEVEL);
    const opponentMaxHp = BASE_HP + (opponentData.level * HP_PER_LEVEL);
    
    const battleState = {
        isPvE: false, message: null, bet: bet, totalPot: bet * 2, turn: [opponentMember.id, challengerMember.id],
        log: [`🔥 بدأ القتال!`], skillPage: 0, processingTurn: false,
        skillCooldowns: { [challengerMember.id]: {}, [opponentMember.id]: {} },
        players: new Map([
            [challengerMember.id, { member: challengerMember, hp: challengerMaxHp, maxHp: challengerMaxHp, weapon: getWeaponData(sql, challengerMember), skills: getAllSkillData(sql, challengerMember), effects: { shield: 0, buff: 0, weaken: 0, poison: 0 } }],
            [opponentMember.id, { member: opponentMember, hp: opponentMaxHp, maxHp: opponentMaxHp, weapon: getWeaponData(sql, opponentMember), skills: getAllSkillData(sql, opponentMember), effects: { shield: 0, buff: 0, weaken: 0, poison: 0 } }]
        ])
    };
    activePvpBattles.set(i.channel.id, battleState);
    const { embeds, components } = buildBattleEmbed(battleState);
    battleState.message = await i.channel.send({ content: `${challengerMember} 🆚 ${opponentMember}`, embeds, components });
}

// 🦑 دالة PvE مع موازنة القوة
async function startPveBattle(interaction, client, sql, playerMember, monsterData, playerWeaponOverride) {
    const getLevel = client.getLevel;
    let playerData = getLevel.get(playerMember.id, interaction.guild.id) || { ...client.defaultData, user: playerMember.id, guild: interaction.guild.id };

    const playerMaxHp = BASE_HP + (playerData.level * HP_PER_LEVEL);
    let finalPlayerWeapon = getWeaponData(sql, playerMember);
    if (!finalPlayerWeapon || finalPlayerWeapon.currentLevel === 0) {
        finalPlayerWeapon = playerWeaponOverride || { name: "سكين صيد", currentDamage: 15 };
    }

    // ⚖️ موازنة القوة (Balancing)
    // دم الوحش = 80% من دم اللاعب (عشان يكون أضعف بشوي)
    const monsterMaxHp = Math.floor(playerMaxHp * 0.8);
    // هجوم الوحش = 90% من هجوم اللاعب (عشان ما يقتلك بضربة وحدة)
    const monsterDamage = Math.floor(finalPlayerWeapon.currentDamage * 0.9);

    const allSkillIds = skillsConfig.map(s => s.id);
    const initialCooldowns = allSkillIds.reduce((acc, id) => { acc[id] = 0; return acc; }, {});

    const battleState = {
        isPvE: true,
        monsterData: monsterData,
        message: null,
        turn: [playerMember.id, "monster"],
        log: [`🦑 **${monsterData.name}** ظهر من الأعماق!`],
        skillPage: 0,
        processingTurn: false,
        skillCooldowns: { [playerMember.id]: { ...initialCooldowns }, "monster": {} },
        players: new Map([
            [playerMember.id, { 
                isMonster: false, member: playerMember, hp: playerMaxHp, maxHp: playerMaxHp, weapon: finalPlayerWeapon, 
                skills: getAllSkillData(sql, playerMember), effects: { shield: 0, buff: 0, weaken: 0, poison: 0 } 
            }],
            ["monster", { 
                isMonster: true, name: monsterData.name, hp: monsterMaxHp, maxHp: monsterMaxHp, 
                weapon: { currentDamage: monsterDamage }, // استخدام القوة الموزونة
                skills: {}, effects: { shield: 0, buff: 0, weaken: 0, poison: 0 } 
            }]
        ])
    };

    activePveBattles.set(interaction.channel.id, battleState);

    const { embeds, components } = buildBattleEmbed(battleState);
    
    // استبدال رسالة الصيد برسالة القتال
    try {
        await interaction.editReply({ 
            content: `🦑 **ظهر ${monsterData.name}!**\nانظر للأسفل لبدء القتال! 👇`,
            embeds: [], 
            components: [] 
        });
    } catch (e) {}

    const battleMessage = await interaction.channel.send({ 
        content: `⚔️ **قتال ضد وحش!** ${playerMember}`, 
        embeds, 
        components 
    });
    
    battleState.message = battleMessage;
}

async function endBattle(battleState, winnerId, sql, reason = "win") {
    if (!battleState.message) return;

    const channelId = battleState.message.channel.id;
    activePvpBattles.delete(channelId);
    activePveBattles.delete(channelId);

    const winner = battleState.players.get(winnerId);
    const embed = new EmbedBuilder().setColor(Colors.Gold);

    if (battleState.isPvE) {
        if (winnerId !== "monster") {
            // اللاعب فاز
            const monster = battleState.monsterData;
            const rewardMora = Math.floor(Math.random() * (monster.max_reward - monster.min_reward + 1)) + monster.min_reward;
            const rewardXP = Math.floor(Math.random() * (300 - 50 + 1)) + 50;

            const client = battleState.message.client;
            let userData = client.getLevel.get(winner.member.id, battleState.message.guild.id);
            userData.mora += rewardMora;
            userData.xp += rewardXP;
            client.setLevel.run(userData);

            // صورة فوز عشوائية
            const randomWinImage = WIN_IMAGES[Math.floor(Math.random() * WIN_IMAGES.length)];

            embed.setTitle(`🏆 قهرت ${monster.name}!`)
                 .setDescription(`💰 **الغنيمة:** ${rewardMora.toLocaleString()} ${EMOJI_MORA}\n✨ **خبرة:** ${rewardXP} XP`)
                 .setImage(randomWinImage); // استخدام صور الفوز
        } else {
            // اللاعب خسر
            const loser = battleState.players.get(battleState.turn.find(id => id !== "monster"));
            const expireTime = Date.now() + (15 * 60 * 1000);
            
            // تطبيق نفس عقوبة الـ PvP (جرح + خصم 15%)
            sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(battleState.message.guild.id, loser.member.id, -15, expireTime, 'mora', -0.15);
            sql.prepare(`INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)`).run(battleState.message.guild.id, loser.member.id, 0, expireTime, 'pvp_wounded', 0);

            // صورة خسارة عشوائية
            const randomLoseImage = LOSE_IMAGES[Math.floor(Math.random() * LOSE_IMAGES.length)];

            embed.setTitle(`💀 هزمك ${battleState.monsterData.name}...`)
                 .setDescription(`🚑 **أنت جريح!**\nلن تتمكن من الصيد أو القتال لمدة 15 دقيقة.\n📉 خصم -15% من القوة والمورا.`)
                 .setColor(Colors.DarkRed)
                 .setImage(randomLoseImage); // استخدام صور الخسارة
        }
    } else {
        // PvP Logic
        const getScore = battleState.message.client.getLevel;
        const setScore = battleState.message.client.setLevel;
        const finalWinnings = battleState.totalPot;
        let winnerData = getScore.get(winnerId, battleState.message.guild.id);
        winnerData.mora += finalWinnings;
        setScore.run(winnerData);
        
        const randomWinImage = WIN_IMAGES[Math.floor(Math.random() * WIN_IMAGES.length)];
        
        embed.setTitle(`🏆 الفائز هو ${cleanDisplayName(winner.member.user.displayName)}!`)
             .setDescription(`💰 **المكسب:** ${finalWinnings.toLocaleString()} ${EMOJI_MORA}`)
             .setImage(randomWinImage);
    }

    await battleState.message.channel.send({ embeds: [embed] });
    await battleState.message.edit({ components: [] }).catch(() => {});
}

function applyPersistentEffects(battleState, attackerId) {
    const attacker = battleState.players.get(attackerId);
    let logEntries = [];
    if (attacker.effects.poison > 0) {
        const poisonDamage = 20;
        attacker.hp -= poisonDamage;
        logEntries.push(`☠️ ${attacker.isMonster ? attacker.name : cleanDisplayName(attacker.member.user.displayName)} تسمم (-${poisonDamage})!`);
    }
    return logEntries;
}

module.exports = {
    activePvpChallenges, activePvpBattles, activePveBattles,
    BASE_HP, HP_PER_LEVEL, SKILL_COOLDOWN_TURNS,
    cleanDisplayName, getUserRace, getWeaponData, getAllSkillData, getUserActiveSkill,
    buildBattleEmbed, startPvpBattle, startPveBattle, endBattle, applyPersistentEffects
};
