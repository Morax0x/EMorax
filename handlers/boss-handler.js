const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Colors, MessageFlags } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

// 👑 الآيدي الخاص بك (بدون كولداون)
const OWNER_ID = '1145327691772481577'; 

const HIT_COOLDOWN = 2 * 60 * 60 * 1000; 
const EMOJI_MORA = '<:mora:1435647151349698621>'; 

// قائمة المهارات الهجومية المسموح بها
const OFFENSIVE_SKILLS_ONLY = [
    'skill_poison', 'skill_gamble', 'race_dragon_skill', 'race_seraphim_skill', 
    'race_demon_skill', 'race_elf_skill', 'race_dark_elf_skill', 'race_vampire_skill', 
    'race_spirit_skill', 'race_ghoul_skill', 'race_hybrid_skill'
];

// دالة رسم الشريط
function createProgressBar(current, max, length = 12) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// دالة تنسيق السجل
function updateBossLog(boss, username, toolName, damage) {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    const logEntry = `╰ **${username}**: استعمل **${toolName}** وتسبب بضرر \`${damage.toLocaleString()}\``;
    logs.unshift(logEntry);
    if (logs.length > 3) logs = logs.slice(0, 3); 
    return JSON.stringify(logs);
}

// دالة لون عشوائي
function getRandomColor() {
    return Math.floor(Math.random() * 16777215);
}

// حالة الزعيم
function getBossState(current, max) {
    const percent = (current / max) * 100;
    if (percent > 75) return "مستعد للقتال";
    if (percent > 50) return "هائج 🔥";
    if (percent > 25) return "متعب 💢";
    return "يحتضر ☠️";
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    if (!boss) return interaction.reply({ content: "❌ **الوحش مات!**", flags: [MessageFlags.Ephemeral] });

    // 1. زر الحالة (❗)
    if (customId === 'boss_status') {
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 5").all(guildID);
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index+1}`;
                return `${medal} <@${entry.userID}> : **${entry.totalDamage.toLocaleString()}**`;
            }).join('\n') 
            : "لا يوجد سجلات.";

        const statusEmbed = new EmbedBuilder()
            .setTitle(`✶ تـقـريـر المعـركـة`)
            .setColor(Colors.Blue)
            .setDescription(
                `✬ الـصـحـة: ${boss.currentHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}\n` +
                `✬ الـحـالـة: ${getBossState(boss.currentHP, boss.maxHP)}\n\n` +
                `✬ أبـطـال الـمـعـركـة:\n${lbText}`
            );
        if (boss.image) statusEmbed.setThumbnail(boss.image);
        return interaction.reply({ embeds: [statusEmbed], flags: [MessageFlags.Ephemeral] });
    }

    // 2. زر المهارات (القائمة)
    if (customId === 'boss_skill_menu') {
        const userSkills = getAllSkillData(sql, member);
        // فلترة: مهارات هجومية فقط + يملكها اللاعب
        const availableSkills = Object.values(userSkills).filter(s => 
            (s.currentLevel > 0 || s.id.startsWith('race_')) && 
            OFFENSIVE_SKILLS_ONLY.includes(s.id)
        );

        if (availableSkills.length === 0) {
            return interaction.reply({ 
                content: "❌ **لا تملك مهارات هجومية!**\nالشفاء والدروع لا تفيد هنا. اشترِ مهارات هجومية أو احصل على عرق.", 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('boss_execute_skill')
            .setPlaceholder('✨ اختر هجوماً خاصاً...')
            .addOptions(
                availableSkills.slice(0, 25).map(skill => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(skill.name)
                        .setDescription(`تأثير: ${skill.description.substring(0, 50)}...`)
                        .setValue(skill.id)
                        .setEmoji(skill.emoji || '✨')
                )
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ content: "**اختر المهارة:**", components: [row], flags: [MessageFlags.Ephemeral] });
    }

    // 3. التنفيذ
    let isSkill = false;
    let skillData = null;

    if (customId === 'boss_execute_skill') {
        isSkill = true;
        const skillId = interaction.values[0]; 
        const userSkills = getAllSkillData(sql, member);
        skillData = Object.values(userSkills).find(s => s.id === skillId);
        if (!skillData) return interaction.reply({ content: "❌ خطأ في المهارة.", flags: [MessageFlags.Ephemeral] });
    } else if (customId !== 'boss_attack') return;

    // الكولداون
    const isOwner = (userID === OWNER_ID); 
    const now = Date.now();
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const minutes = Math.floor(((cooldownData.lastHit + HIT_COOLDOWN) - now) / 60000);
            return interaction.reply({ content: `⏳ **انتظر!** باقي **${minutes} دقيقة**.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // --- حساب الضرر الأساسي (السلاح) ---
    let weaponDamage = 10; 
    const userRace = getUserRace(member, sql);
    let toolName = "خنجر"; 

    if (userRace) {
        const weapon = getWeaponData(sql, member);
        if (weapon && weapon.currentLevel > 0) {
            weaponDamage = weapon.currentDamage; 
            toolName = weapon.name;
        } else {
            weaponDamage = 15; 
            toolName = "خنجر (افتراضي)";
        }
    }

    let finalDamage = weaponDamage;

    // --- حساب ضرر المهارات (منطق PvP) ---
    if (isSkill && skillData) {
        toolName = skillData.name;
        
        switch (skillData.id) {
            case 'skill_gamble': // مقامرة
                // 50% ضربة قوية جداً (2.5x)، 50% ضربة ضعيفة (0.5x)
                if (Math.random() < 0.5) {
                    finalDamage = Math.floor(weaponDamage * 2.5);
                    toolName += " (حظ أسطوري!)";
                } else {
                    finalDamage = Math.floor(weaponDamage * 0.5);
                    toolName += " (حظ سيء...)";
                }
                break;

            case 'skill_poison': // تسميم
            case 'race_dark_elf_skill': // سم الظلال
                // ضرر السلاح + قيمة المهارة * 2 (تعويضاً عن الضرر المستمر)
                finalDamage = Math.floor(weaponDamage + (skillData.effectValue * 3)); 
                break;

            case 'race_dragon_skill': // نفس التنين (ضرر حقيقي)
                // ضرر السلاح + قيمة عالية ثابتة
                finalDamage = Math.floor(weaponDamage + (skillData.effectValue * 5));
                break;

            case 'race_demon_skill': // عهد الدم
                // ضرر مضاعف (بدون خصم دم من اللاعب لتبسيط البوس)
                finalDamage = Math.floor(weaponDamage * 2.2);
                break;

            case 'race_elf_skill': // رمية مزدوجة
                // ضربتين بقوة 70% لكل وحدة (المجموع 140%)
                finalDamage = Math.floor(weaponDamage * 1.4);
                break;

            case 'race_vampire_skill': // التهام
            case 'race_seraphim_skill': // حكم سماوي
                // ضرر متوسط (لأن الشفاء لا يفيد هنا، نعوضه بضرر معقول)
                finalDamage = Math.floor(weaponDamage * 1.3);
                break;

            default:
                // باقي المهارات الهجومية: نسبة مئوية من السلاح
                // (effectValue عادة يكون 10-50، فنعتبره نسبة زيادة)
                const multiplier = 1 + (skillData.effectValue / 100);
                finalDamage = Math.floor(weaponDamage * multiplier);
                break;
        }
    }

    // كريتيكال (20% فرصة لزيادة 50%)
    let isCrit = false;
    if (Math.random() < 0.2) {
        finalDamage = Math.floor(finalDamage * 1.5);
        isCrit = true;
    }

    // تطبيق الضرر
    let newHP = boss.currentHP - finalDamage;
    if (newHP < 0) newHP = 0;

    const newLogStr = updateBossLog(boss, member.displayName, toolName, finalDamage);
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ? WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
    if (!isOwner) {
        sql.prepare("INSERT OR REPLACE INTO boss_cooldowns (guildID, userID, lastHit) VALUES (?, ?, ?)").run(guildID, userID, now);
    }

    const userDmgRecord = sql.prepare("SELECT totalDamage FROM boss_leaderboard WHERE guildID = ? AND userID = ?").get(guildID, userID);
    sql.prepare("INSERT OR REPLACE INTO boss_leaderboard (guildID, userID, totalDamage) VALUES (?, ?, ?)").run(guildID, userID, (userDmgRecord ? userDmgRecord.totalDamage : 0) + finalDamage);

    // الجوائز
    let rewardMsg = "";
    const roll = Math.random() * 100;
    let userData = client.getLevel.get(userID, guildID) || { ...client.defaultData, user: userID, guild: guildID };
    
    // معادلة حظ بسيطة
    if (roll > 95) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **كوبون خصم ${discount}%**`;
    } else if (roll > 80) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) userData.mora += amount; else userData.xp += amount;
        rewardMsg = `🧪 **${amount}** ${isMora ? 'مورا' : 'XP'}`;
    } else if (roll > 40) {
        const amount = Math.floor(Math.random() * 500) + 50;
        userData.mora += amount;
        rewardMsg = `💰 **${amount}** مورا`;
    } else {
        const amount = Math.floor(Math.random() * 500) + 20;
        userData.xp += amount;
        userData.totalXP += amount;
        rewardMsg = `✨ **${amount}** خبرة`;
    }
    client.setLevel.run(userData);

    // التحديث
    const bossMsg = await interaction.channel.messages.fetch(boss.messageID).catch(() => null);
    if (bossMsg) {
        const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
        const progressBar = createProgressBar(newHP, boss.maxHP, 12); 
        let logsArr = [];
        try { logsArr = JSON.parse(newLogStr); } catch(e){}
        const logDisplay = logsArr.length > 0 ? logsArr.join('\n') : "╰ بانتظار الهجوم الأول...";

        const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
            .setColor(getRandomColor())
            .setDescription(
                `✬ ظـهـر زعـيـم في السـاحـة تـعانـوا عـلـى قتاله واكسبوا الجوائـز !\n\n` +
                `✬ **نـقـاط صـحـة الزعـيـم:**\n` +
                `${progressBar} **${hpPercent}%**\n` +
                `╰ **${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP\n\n` +
                `✬ **سـجـل الـمـعـركـة:**\n` +
                `${logDisplay}`
            )
            .setFields([]); 

        if (newHP <= 0) {
            newEmbed.setTitle(`💀 **سقط ${boss.name}!**`)
                .setDescription(`🎉 **النصر للأبطال!**\n\n👑 صاحب الضربة القاضية:\n**${member.displayName}**`)
                .setColor(Colors.Gold);
            await bossMsg.edit({ embeds: [newEmbed], components: [] });
            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);
            
            return interaction.reply({ 
                content: `⚔️ **استعملت ${toolName} وتسببت بضرر \`${finalDamage.toLocaleString()}\` (قاضية!)**\n🏆 ${rewardMsg}`, 
                flags: [MessageFlags.Ephemeral] 
            });
        } else {
            await bossMsg.edit({ embeds: [newEmbed] });
        }
    }

    const critText = isCrit ? " (Crit!)" : "";
    await interaction.reply({ 
        content: `⚔️ **استعملت ${toolName} وتسببت بضرر \`${finalDamage.toLocaleString()}\`${critText}**\n🎁 ${rewardMsg}`, 
        flags: [MessageFlags.Ephemeral] 
    });
}

module.exports = { handleBossInteraction };
