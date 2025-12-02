const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, ComponentType } = require("discord.js");
const path = require('path');

const rootDir = process.cwd();
const weaponsConfig = require(path.join(rootDir, 'json', 'weapons-config.json'));
const skillsConfig = require(path.join(rootDir, 'json', 'skills-config.json'));

const EMOJI_MORA = '<:mora:1435647151349698621>';
const BASE_HP = 100;
const HP_PER_LEVEL = 4;
const SKILL_COOLDOWN_TURNS = 3;

const activePvpChallenges = new Set();
const activePvpBattles = new Map();

function cleanDisplayName(name) {
    if (!name) return "لاعب";
    let clean = name.replace(/<a?:.+?:\d+>/g, '');
    clean = clean.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\DFFF]|\uD83D[\uDC00-\DFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\DFFF]/g, '');
    clean = clean.replace(/\s*[|・•»✦]\s*\d+\s* ?🔥/g, '');
    return clean.trim();
}

function getUserRace(member, sql) {
    // 🛠️ الإصلاح الأمني: التحقق من وجود العضو والسيرفر
    if (!member || !member.guild) {
        return null;
    }

    const allRaceRoles = sql.prepare("SELECT roleID, raceName FROM race_roles WHERE guildID = ?").all(member.guild.id);
    // 🛠️ فحص إضافي: التأكد من وجود roles
    if (!member.roles || !member.roles.cache) return null;

    const userRoleIDs = member.roles.cache.map(r => r.id);
    const userRace = allRaceRoles.find(r => userRoleIDs.includes(r.roleID));
    return userRace || null;
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
            if (skillConfig) {
                skillsOutput[raceSkillId] = { ...skillConfig, currentLevel: 0, effectValue: 0 };
            }
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
            return { 
                name: skillConfig.name, 
                level: level, 
                damage: power 
            };
        }
    }
    return null;
}

function buildHpBar(currentHp, maxHp) {
    currentHp = Math.max(0, currentHp);
    const percentage = (currentHp / maxHp) * 10;
    const filled = '█';
    const empty = '░';
    const bar = filled.repeat(Math.max(0, Math.floor(percentage))) + empty.repeat(Math.max(0, 10 - Math.floor(percentage)));
    return `[${bar}] ${currentHp}/${maxHp}`;
}

function buildSkillButtons(battleState, attackerId, page = 0) {
    const attacker = battleState.players.get(attackerId);
    const cooldowns = battleState.skillCooldowns[attackerId];

    const availableSkills = Object.values(attacker.skills).filter(s => s.currentLevel > 0 || s.id.startsWith('race_'));

    const skillsPerPage = 4;
    const totalPages = Math.ceil(availableSkills.length / skillsPerPage);
    page = Math.max(0, Math.min(page, totalPages - 1));
    battleState.skillPage = page;

    const startIndex = page * skillsPerPage;
    const endIndex = startIndex + skillsPerPage;
    const skillsToShow = availableSkills.slice(startIndex, endIndex);

    const skillButtons = new ActionRowBuilder();
    skillsToShow.forEach(skill => {
        const cooldown = cooldowns[skill.id] || 0;
        skillButtons.addComponents(
            new ButtonBuilder()
                .setCustomId(`pvp_skill_use_${skill.id}`)
                .setLabel(`${skill.name} ${skill.currentLevel > 0 ? `(Lv.${skill.currentLevel})` : ''}`)
                .setEmoji(skill.emoji)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(cooldown > 0)
        );
    });

    const navigationButtons = new ActionRowBuilder();
    navigationButtons.addComponents(
        new ButtonBuilder().setCustomId('pvp_skill_back').setLabel('العودة').setStyle(ButtonStyle.Secondary)
    );

    if (totalPages > 1) {
        navigationButtons.addComponents(
            new ButtonBuilder()
                .setCustomId(`pvp_skill_page_${page - 1}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`pvp_skill_page_${page + 1}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
        );
    }

    const components = [skillButtons, navigationButtons].filter(row => row.components.length > 0);
    return components;
}

function buildEffectsString(effects) {
    let effectsArray = [];
    if (effects.shield > 0) effectsArray.push(`🛡️ درع (${effects.shield})`);
    if (effects.buff > 0) effectsArray.push(`💪 معزز (${effects.buff})`);
    if (effects.weaken > 0) effectsArray.push(`📉 إضعاف (${effects.weaken})`);
    if (effects.poison > 0) effectsArray.push(`☠️ تسمم (${effects.poison})`);
    if (effects.penetrate > 0) effectsArray.push(`👻 اختراق (${effects.penetrate})`);
    if (effects.rebound_active > 0) effectsArray.push(`🔄 ارتداد (${effects.rebound_active})`);

    return effectsArray.length > 0 ? effectsArray.join(' | ') : 'لا يوجد';
}

function buildBattleEmbed(battleState, skillSelectionMode = false, skillPage = 0) {
    const [attackerId, defenderId] = battleState.turn;
    const attacker = battleState.players.get(attackerId);
    const defender = battleState.players.get(defenderId);

    const cleanAttackerName = cleanDisplayName(attacker.member.user.displayName);
    const cleanDefenderName = cleanDisplayName(defender.member.user.displayName);

    const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${cleanAttackerName} 🆚 ${cleanDefenderName} ⚔️`)
        .setColor(Colors.Red)
        .setDescription(`الرهان: **${(battleState.bet * 2).toLocaleString()}** ${EMOJI_MORA}\n\n**الدور الآن لـ:** ${attacker.member}`)
        .addFields(
            {
                name: `${cleanAttackerName} (مهاجم)`,
                value: `**HP:** ${buildHpBar(attacker.hp, attacker.maxHp)}\n` +
                       `**الضرر:** \`${attacker.weapon ? attacker.weapon.currentDamage : 0} DMG\`\n` +
                       `**التأثيرات:** ${buildEffectsString(attacker.effects)}`,
                inline: true
            },
            {
                name: `${cleanDefenderName} (مدافع)`,
                value: `**HP:** ${buildHpBar(defender.hp, defender.maxHp)}\n` +
                       `**الضرر:** \`${defender.weapon ? defender.weapon.currentDamage : 0} DMG\`\n` +
                       `**التأثيرات:** ${buildEffectsString(defender.effects)}`,
                inline: true
            }
        );

    if (battleState.log.length > 0) {
        embed.addFields({ name: "📝 سجل القتال:", value: battleState.log.slice(-3).join('\n'), inline: false });
    }

    if (skillSelectionMode) {
        const skillComponents = buildSkillButtons(battleState, attackerId, skillPage);
        embed.setTitle(`🌟 اختر المهارة`)
             .setDescription(`اختر مهارة لاستخدامها (تستهلك الدور).`);

        return { embeds: [embed], components: skillComponents };
    }

    const mainButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pvp_action_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
        new ButtonBuilder().setCustomId('pvp_action_skill').setLabel('مـهــارات').setStyle(ButtonStyle.Primary).setEmoji('✨'),
        new ButtonBuilder().setCustomId('pvp_action_forfeit').setLabel('انسحاب').setStyle(ButtonStyle.Secondary).setEmoji('🏳️')
    );

    return { embeds: [embed], components: [mainButtons] };
}

async function startPvpBattle(i, client, sql, challengerMember, opponentMember, bet) {
    const getLevel = i.client.getLevel;
    const setLevel = i.client.setLevel;

    let challengerData = getLevel.get(challengerMember.id, i.guild.id);
    let opponentData = getLevel.get(opponentMember.id, i.guild.id);

    if (!challengerData) challengerData = { ...client.defaultData, user: challengerMember.id, guild: i.guild.id };
    if (!opponentData) opponentData = { ...client.defaultData, user: opponentMember.id, guild: i.guild.id };

    challengerData.mora -= bet;
    opponentData.mora -= bet;
    setLevel.run(challengerData);
    setLevel.run(opponentData);

    const challengerMaxHp = BASE_HP + (challengerData.level * HP_PER_LEVEL);
    const opponentMaxHp = BASE_HP + (opponentData.level * HP_PER_LEVEL);

    let challengerStartHp = challengerMaxHp;
    let opponentStartHp = opponentMaxHp;
    let battleLog = [];

    const now = Date.now();
    const challengerWound = sql.prepare("SELECT 1 FROM user_buffs WHERE userID = ? AND guildID = ? AND buffType = 'pvp_wounded' AND expiresAt > ?").get(challengerMember.id, i.guild.id, now);
    if (challengerWound) { 
        challengerStartHp = Math.floor(challengerMaxHp * 0.85); 
        battleLog.push(`🤕 ${cleanDisplayName(challengerMember.user.displayName)} يبدأ جريحاً! (HP -15%)`);
    }

    const opponentWound = sql.prepare("SELECT 1 FROM user_buffs WHERE userID = ? AND guildID = ? AND buffType = 'pvp_wounded' AND expiresAt > ?").get(opponentMember.id, i.guild.id, now);
    if (opponentWound) { 
        opponentStartHp = Math.floor(opponentMaxHp * 0.85); 
        battleLog.push(`🤕 ${cleanDisplayName(opponentMember.user.displayName)} يبدأ جريحاً! (HP -15%)`);
    }

    battleLog.push(`🔥 بدأ القتال!`);

    const allSkillIds = skillsConfig.map(s => s.id);
    const initialCooldowns = allSkillIds.reduce((acc, id) => { acc[id] = 0; return acc; }, {});

    const battleState = {
        message: null,
        bet: bet,
        totalPot: bet * 2,
        turn: [opponentMember.id, challengerMember.id],
        log: battleLog,
        skillPage: 0,
        processingTurn: false,
        skillCooldowns: {
            [challengerMember.id]: { ...initialCooldowns },
            [opponentMember.id]: { ...initialCooldowns }
        },
        players: new Map([
            [challengerMember.id, { member: challengerMember, hp: challengerStartHp, maxHp: challengerMaxHp, weapon: getWeaponData(sql, challengerMember), skills: getAllSkillData(sql, challengerMember), effects: { shield: 0, buff: 0, rebound_active: 0, weaken: 0, poison: 0, penetrate: 0 } }],
            [opponentMember.id, { member: opponentMember, hp: opponentStartHp, maxHp: opponentMaxHp, weapon: getWeaponData(sql, opponentMember), skills: getAllSkillData(sql, opponentMember), effects: { shield: 0, buff: 0, rebound_active: 0, weaken: 0, poison: 0, penetrate: 0 } }]
        ]),
        collectors: {}
    };

    activePvpBattles.set(i.channel.id, battleState);

    const { embeds, components } = buildBattleEmbed(battleState);
    const battleMessage = await i.channel.send({ content: `${challengerMember} 🆚 ${opponentMember}`, embeds, components });
    battleState.message = battleMessage;

    const filter = (interaction) => battleState.players.has(interaction.user.id);
    const buttonCollector = battleMessage.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 5 * 60 * 1000 });

    battleState.collectors = { button: buttonCollector };

    buttonCollector.on('end', (collected, reason) => {
        const battleStateToEnd = activePvpBattles.get(i.channel.id);
        if (!battleStateToEnd) return; 

        if (reason === 'time') {
            const attackerId = battleStateToEnd.turn[0];
            const defenderId = battleStateToEnd.turn[1];
            activePvpBattles.delete(i.channel.id);
            activePvpChallenges.delete(i.channel.id);
            battleMessage.edit({ content: "⌛ انتهى وقت المعركة!", components: [] }).catch(() => {});
        }
    });
}

async function endBattle(battleState, winnerId, sql, reason = "win", calculateMoraBuffFunc) {
    if (!activePvpBattles.has(battleState.message.channel.id)) return;

    activePvpChallenges.delete(battleState.message.channel.id);
    activePvpBattles.delete(battleState.message.channel.id);

    if (battleState.collectors.button) battleState.collectors.button.stop();

    const getScore = battleState.message.client.getLevel;
    const setScore = battleState.message.client.setLevel;
    const guildId = battleState.message.guild.id;

    const loserId = Array.from(battleState.players.keys()).find(id => id !== winnerId);
    const winner = battleState.players.get(winnerId);
    const loser = battleState.players.get(loserId);

    let bonus = 0;
    if (calculateMoraBuffFunc) {
        const moraMultiplier = calculateMoraBuffFunc(winner.member, sql);
        bonus = Math.floor(battleState.bet * moraMultiplier) - battleState.bet;
    }
    const finalWinnings = battleState.totalPot + bonus;

    let winnerData = getScore.get(winnerId, guildId);
    winnerData.mora += finalWinnings;
    winnerData.xp += 100; 
    setScore.run(winnerData);

    const winnerExpiresAt = Date.now() + (5 * 60 * 1000);
    sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guildId, winnerId, 3, winnerExpiresAt, 'xp', 0.03);

    const loserExpiresAt = Date.now() + (15 * 60 * 1000);
    sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guildId, loserId, 0, loserExpiresAt, 'pvp_wounded', 0);

    const embed = new EmbedBuilder()
        .setTitle(`🏆 الفائز هو ${cleanDisplayName(winner.member.user.displayName)}!`)
        .setDescription(
            `💰 **المكسب:** ${finalWinnings.toLocaleString()} ${EMOJI_MORA}\n` +
            `🗡️ **الخاسر:** ${loser.member} (أصبح جريحاً لمدة 15 دقيقة)\n` +
            (reason === "forfeit" ? "🏳️ سبب الفوز: انسحاب الخصم." : "⚔️ سبب الفوز: القضاء على الخصم.")
        )
        .setColor(Colors.Gold)
        .setThumbnail(winner.member.displayAvatarURL());

    await battleState.message.channel.send({ embeds: [embed] });
    
    await battleState.message.edit({ components: [] }).catch(() => {});
}

function applyPersistentEffects(battleState, attackerId) {
    const attacker = battleState.players.get(attackerId);
    let logEntries = [];

    if (attacker.effects.poison > 0) {
        const poisonDamage = 20;
        attacker.hp -= poisonDamage;
        logEntries.push(`☠️ ${cleanDisplayName(attacker.member.user.displayName)} يتألم من السم (-${poisonDamage} HP)!`);
    }

    return logEntries;
}

module.exports = {
    activePvpChallenges,
    activePvpBattles,
    BASE_HP,
    HP_PER_LEVEL,
    SKILL_COOLDOWN_TURNS,
    cleanDisplayName,
    getUserRace,
    getWeaponData,
    getAllSkillData,
    getUserActiveSkill,
    buildBattleEmbed,
    startPvpBattle,
    endBattle,
    applyPersistentEffects,
};
