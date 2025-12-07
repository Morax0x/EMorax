const { EmbedBuilder, ActionRowBuilder, Colors, MessageFlags } = require("discord.js");
const { getWeaponData, getUserRace, getAllSkillData } = require('./pvp-core.js');

const OWNER_ID = '1145327691772481577'; 
const HIT_COOLDOWN = 2 * 60 * 60 * 1000; 

function createProgressBar(current, max, length = 12) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function updateBossLog(boss, username, toolName, damage) {
    let logs = [];
    try { logs = JSON.parse(boss.lastLog || '[]'); } catch (e) {}
    const logEntry = `╰ **${username}**: استعمل **${toolName}** وتسبب بضرر \`${damage.toLocaleString()}\``;
    logs.unshift(logEntry);
    if (logs.length > 3) logs = logs.slice(0, 3); 
    return JSON.stringify(logs);
}

function getRandomColor() {
    return Math.floor(Math.random() * 16777215);
}

function getBossState(current, max) {
    const percent = (current / max) * 100;
    if (percent > 75) return "مستعد للقتال";
    if (percent > 50) return "هائج 🔥";
    if (percent > 25) return "متعب 💢";
    return "يحتضر ☠️";
}

function getRequiredXP(level) {
    return 5 * (level * level) + (50 * level) + 100;
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton()) return;
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    if (!boss) return interaction.reply({ content: "❌ **الوحش مات!**", flags: [MessageFlags.Ephemeral] });

    // 1. زر الحالة (تقرير المعركة)
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

    // 2. التحقق من نوع الزر (هجوم عادي أو مهارة عرق)
    let isSkill = false;
    let skillData = null;

    if (customId === 'boss_skill_menu') { // هذا الزر الآن ينفذ مهارة العرق مباشرة
        isSkill = true;
        const userSkills = getAllSkillData(sql, member);
        // جلب أي مهارة تبدأ بـ race_ (مهارة العرق)
        skillData = Object.values(userSkills).find(s => s.id.startsWith('race_'));
        
        if (!skillData) {
            return interaction.reply({ 
                content: "❌ **لا تملك مهارة عرق لتنفيذها!**", 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    } else if (customId !== 'boss_attack') {
        return; // تجاهل أي أزرار أخرى
    }

    // 3. التحقق من الكولداون (مشترك للهجوم والمهارة)
    const isOwner = (userID === OWNER_ID); 
    const now = Date.now();
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const minutes = Math.floor(((cooldownData.lastHit + HIT_COOLDOWN) - now) / 60000);
            return interaction.reply({ content: `⏳ **انتظر!** باقي **${minutes} دقيقة**.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // --- حساب ضرر السلاح الأساسي ---
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
    // 🔥 حساب ضرر مهارة العرق (فقط) 🔥
    // =========================================================
    if (isSkill && skillData) {
        toolName = skillData.name;
        const val = skillData.effectValue;

        switch (skillData.id) {
            case 'race_dragon_skill': 
                // مهارة التنين: ضرر ثابت وعالي
                finalDamage = val; 
                break;

            case 'race_elf_skill': 
                // مهارة الإلف: سلاح + قيمة المهارة
                finalDamage = Math.floor(weaponDamage + val); 
                break;
            
            // يمكنك إضافة حالات خاصة لأعراق أخرى هنا إذا أردت منطقاً مختلفاً
            default: 
                // الافتراضي لمهارات العرق: السلاح + قيمة المهارة
                finalDamage = Math.floor(weaponDamage + val); 
                break;
        }
    }

    // Crit (20%)
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
    // 🔥🔥 نظام الجوائز 🔥🔥
    // =========================================================
    let rewardMsg = "";
    const roll = Math.random() * 100;
    
    let userData = client.getLevel.get(userID, guildID) || { ...client.defaultData, user: userID, guild: guildID };
    
    userData.level = parseInt(userData.level) || 1;
    userData.xp = parseInt(userData.xp) || 0;
    
    let xpToAdd = 0;

    if (roll > 95) { 
        const discount = Math.floor(Math.random() * 10) + 1;
        sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
        rewardMsg = `🎫 **كوبون خصم ${discount}%**`;
    } else if (roll > 80) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) { userData.mora += amount; rewardMsg = `🧪 **${amount}** مورا`; }
        else { xpToAdd = amount; rewardMsg = `🧪 **${amount}** XP`; }
    } else if (roll > 40) {
        const amount = Math.floor(Math.random() * 500) + 50;
        userData.mora += amount; rewardMsg = `💰 **${amount}** مورا`;
    } else {
        xpToAdd = Math.floor(Math.random() * 500) + 20; rewardMsg = `✨ **${xpToAdd}** خبرة`;
    }

    if (xpToAdd > 0) {
        userData.xp += xpToAdd;
        userData.totalXP += xpToAdd;
        
        let requiredXP = getRequiredXP(userData.level);
        let leveledUp = false;

        while (userData.xp >= requiredXP) {
            userData.xp -= requiredXP;
            userData.level += 1;
            requiredXP = getRequiredXP(userData.level);
            leveledUp = true;
        }
        if (leveledUp) rewardMsg += `\n🆙 **Level Up!** -> ${userData.level}`;
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
            ).setFields([]); 

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
