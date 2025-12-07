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
                        .setDescription(`المستوى: ${skill.currentLevel} | الضرر الأساسي: ${skill.damage || 20}`)
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

    // =========================================================
    // 🔥 الجزء المعدل: حساب ضرر المهارات بناءً على اللفل 🔥
    // =========================================================
    if (isSkill && skillData) {
        toolName = skillData.name;
        
        // 1. تحديد الضرر الأساسي ولفل المهارة
        const baseSkillDamage = skillData.damage || 25; // لو مافي ضرر بالداتا نعتبره 25
        const skillLevel = skillData.currentLevel || 1;
        
        // 2. نسبة الزيادة لكل لفل (15%)
        const levelMultiplier = 0.15; 

        // 3. المعادلة: الأساسي * (1 + (اللفل-1 * النسبة))
        // مثال: لفل 1 = 100% | لفل 2 = 115% | لفل 10 = 235%
        let calculatedSkillDamage = Math.floor(baseSkillDamage * (1 + ((skillLevel - 1) * levelMultiplier)));

        // 4. حالات خاصة لبعض المهارات (تضاف فوق المعادلة الأساسية)
        switch (skillData.id) {
            case 'skill_gamble': // مقامرة
                if (Math.random() < 0.5) {
                    calculatedSkillDamage = Math.floor(calculatedSkillDamage * 2.5); // ضربة حظ
                    toolName += " (JACPOT!)";
                } else {
                    calculatedSkillDamage = Math.floor(calculatedSkillDamage * 0.5); // حظ سيء
                    toolName += " (فشل...)";
                }
                break;

            case 'race_demon_skill': // قوة شيطانية
                calculatedSkillDamage = Math.floor(calculatedSkillDamage * 1.5);
                break;

            case 'race_dragon_skill': // تنين
                calculatedSkillDamage = Math.floor(calculatedSkillDamage * 1.8);
                break;

            // يمكنك إضافة حالات أخرى، لكن الآن الكل يعتمد على اللفل بشكل أساسي
        }

        // جمع ضرر السلاح + ضرر المهارة المحسوب
        finalDamage = weaponDamage + calculatedSkillDamage;
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

    // =========================================================
    // 🎁 الجزء المعدل: الجوائز ونظام التلفيل التلقائي 🎁
    // =========================================================
    let rewardMsg = "";
    const roll = Math.random() * 100;
    
    // جلب بيانات اللاعب
    let userData = client.getLevel.get(userID, guildID) || { 
        ...client.defaultData, 
        user: userID, 
        guild: guildID,
        max_xp: 500 // قيمة افتراضية في حال كانت غير موجودة لتجنب الخطأ
    };
    
    // التأكد من وجود max_xp
    if (!userData.max_xp || userData.max_xp <= 0) userData.max_xp = (userData.level * 500) + 500;

    let xpToAdd = 0;

    if (roll > 95) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **كوبون خصم ${discount}%**`;
    } else if (roll > 80) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) {
            userData.mora += amount;
            rewardMsg = `🧪 **${amount}** مورا`;
        } else {
            xpToAdd = amount;
            rewardMsg = `🧪 **${amount}** XP`;
        }
    } else if (roll > 40) {
        const amount = Math.floor(Math.random() * 500) + 50;
        userData.mora += amount;
        rewardMsg = `💰 **${amount}** مورا`;
    } else {
        xpToAdd = Math.floor(Math.random() * 500) + 20;
        rewardMsg = `✨ **${xpToAdd}** خبرة`;
    }

    // إضافة الـ XP ومعالجة التلفيل (LOOP)
    if (xpToAdd > 0) {
        userData.xp += xpToAdd;
        userData.totalXP += xpToAdd;

        let leveledUp = false;
        // حلقة تكرار: طالما الـ XP الحالي أكبر من المطلوب، ارفع لفل واخصم
        while (userData.xp >= userData.max_xp) {
            userData.xp -= userData.max_xp;
            userData.level += 1;
            // معادلة صعوبة اللفل الجديد (زيادة 20% كل لفل)
            userData.max_xp = Math.floor(userData.max_xp * 1.2);
            leveledUp = true;
        }

        if (leveledUp) {
            rewardMsg += `\n🆙 **Level Up!** أصبحت بالمستوى **${userData.level}**!`;
            // يمكنك هنا إرسال رسالة منفصلة في الشات إذا أردت
        }
    }

    // حفظ البيانات النهائية
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
