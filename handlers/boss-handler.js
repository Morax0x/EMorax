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

function getRequiredXP(level) {
    return 5 * (level * level) + (50 * level) + 100;
}

// دالة مساعدة لحساب وقت عشوائي (بالملي ثانية)
function getRandomDuration(minMinutes, maxMinutes) {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

// دالة تنسيق الوقت (للعرض)
function formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours} س و ${minutes} د`;
    return `${minutes} د`;
}

async function handleBossInteraction(interaction, client, sql) {
    if (!interaction.isButton()) return;

    // 🔥🔥 إصلاح تلقائي لقاعدة البيانات 🔥🔥
    try {
        sql.prepare("SELECT totalHits FROM world_boss LIMIT 1").get();
    } catch (err) {
        if (err.message.includes("no such column: totalHits")) {
            sql.prepare("ALTER TABLE world_boss ADD COLUMN totalHits INTEGER DEFAULT 0").run();
            console.log("[Auto-Fix] ✅ تم إضافة العمود الناقص totalHits إلى قاعدة البيانات.");
        }
    }
    
    const { customId, guild, user, member } = interaction;
    const guildID = guild.id;
    const userID = user.id;

    const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
    if (!boss) return interaction.reply({ content: "❌ **الوحش مات!**", flags: [MessageFlags.Ephemeral] });

    // 1. زر الحالة
    if (customId === 'boss_status') {
        const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 3").all(guildID);
        let lbText = leaderboard.length > 0 
            ? leaderboard.map((entry, index) => `${index + 1}# <@${entry.userID}> : **${entry.totalDamage.toLocaleString()}**`).join('\n') 
            : "لا يوجد سجلات.";

        const totalHits = boss.totalHits || 0;

        const statusEmbed = new EmbedBuilder()
            .setTitle(`✥ تـقـريـر المعـركـة`)
            .setColor(Colors.Blue)
            .setDescription(
                `✶ **معـلومـات الزعـيـم:**\n` +
                `- الاسـم: **${boss.name}**\n` +
                `- نقـاط الصحـة: **${boss.currentHP.toLocaleString()} / ${boss.maxHP.toLocaleString()}**\n` +
                `- هجمات متلـقـية: **${totalHits}**\n\n` +
                `✶ **اعـلـى ضـرر:**\n${lbText}`
            );
        if (boss.image) statusEmbed.setThumbnail(boss.image);
        return interaction.reply({ embeds: [statusEmbed], flags: [MessageFlags.Ephemeral] });
    }

    // 2. التحقق من الزر والمهارة
    let isSkill = false;
    let skillData = null;

    if (customId === 'boss_skill_menu') { 
        isSkill = true;
        const userSkills = getAllSkillData(sql, member);
        skillData = Object.values(userSkills).find(s => s.id.startsWith('race_'));
        
        if (!skillData) {
            return interaction.reply({ 
                content: "❌ **لا تملك مهارة عرق لتنفيذها!**", 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    } else if (customId !== 'boss_attack') return;

    // 3. الكولداون
    const isOwner = (userID === OWNER_ID); 
    const now = Date.now();
    if (!isOwner) {
        const cooldownData = sql.prepare("SELECT lastHit FROM boss_cooldowns WHERE guildID = ? AND userID = ?").get(guildID, userID);
        if (cooldownData && (now - cooldownData.lastHit) < HIT_COOLDOWN) {
            const minutes = Math.floor(((cooldownData.lastHit + HIT_COOLDOWN) - now) / 60000);
            return interaction.reply({ content: `⏳ **انتظر!** باقي **${minutes} دقيقة**.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // --- حساب الضرر ---
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

    if (isSkill && skillData) {
        toolName = skillData.name;
        const val = skillData.effectValue;
        finalDamage = Math.floor(weaponDamage + val); 
    }

    // ===========================================
    // 🔥🔥 Crit (5%) 🔥🔥
    // ===========================================
    let isCrit = false;
    if (Math.random() < 0.05) { 
        finalDamage = Math.floor(finalDamage * 1.5);
        isCrit = true;
    }

    // تطبيق الضرر والتحديث
    let newHP = boss.currentHP - finalDamage;
    if (newHP < 0) newHP = 0;

    // ✅ التعديل هنا: استخدام member.user.displayName بدلاً من member.displayName
    const newLogStr = updateBossLog(boss, member.user.displayName, toolName, finalDamage);
    
    // التحديث مع التأكد من وجود totalHits
    sql.prepare("UPDATE world_boss SET currentHP = ?, lastLog = ?, totalHits = COALESCE(totalHits, 0) + 1 WHERE guildID = ?").run(newHP, newLogStr, guildID);
    
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

    if (roll > 98) { 
        const existingCoupon = sql.prepare("SELECT 1 FROM user_coupons WHERE userID = ? AND guildID = ?").get(userID, guildID);
        
        if (!existingCoupon) {
            const discount = Math.floor(Math.random() * 10) + 1;
            sql.prepare("INSERT INTO user_coupons (guildID, userID, discountPercent) VALUES (?, ?, ?)").run(guildID, userID, discount);
            rewardMsg = `🎫 **كوبون خصم ${discount}%**`;
        } else {
            const duration = getRandomDuration(10, 180); 
            const percent = Math.floor(Math.random() * 46) + 5; 
            const expiresAt = Date.now() + duration;
            
            sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guildID, userID, percent, expiresAt, 'xp', percent / 100);
            rewardMsg = `🆙 **تعزيز XP ${percent}%** لمدة \`${formatDuration(duration)}\``;
        }

    } else if (roll > 90) { // بف اكس بي
        const duration = getRandomDuration(10, 180);
        const percent = Math.floor(Math.random() * 46) + 5; 
        const expiresAt = Date.now() + duration;
        
        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guildID, userID, percent, expiresAt, 'xp', percent / 100);
        rewardMsg = `🆙 **تعزيز XP ${percent}%** لمدة \`${formatDuration(duration)}\``;

    } else if (roll > 80) { // بف مورا
        const duration = getRandomDuration(10, 180);
        const percent = Math.floor(Math.random() * 8) + 1; 
        const expiresAt = Date.now() + duration;

        sql.prepare("INSERT INTO user_buffs (guildID, userID, buffPercent, expiresAt, buffType, multiplier) VALUES (?, ?, ?, ?, ?, ?)").run(guildID, userID, percent, expiresAt, 'mora', percent / 100);
        rewardMsg = `💰 **تعزيز مورا ${percent}%** لمدة \`${formatDuration(duration)}\``;

    } else if (roll > 50) {
        const isMora = Math.random() > 0.5;
        const amount = Math.floor(Math.random() * 400) + 100;
        if (isMora) { userData.mora += amount; rewardMsg = `🧪 **${amount}** مورا`; }
        else { xpToAdd = amount; rewardMsg = `🧪 **${amount}** XP`; }

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

    // تحديث الرسالة
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
            const leaderboard = sql.prepare("SELECT userID, totalDamage FROM boss_leaderboard WHERE guildID = ? ORDER BY totalDamage DESC LIMIT 3").all(guildID);
            let lbText = "لا يوجد.";
            if (leaderboard.length > 0) {
                lbText = leaderboard.map((entry, index) => `${index + 1}. <@${entry.userID}>: **${entry.totalDamage.toLocaleString()}**`).join('\n');
            }
            
            let finalHits = 0;
            try {
                const finalBossData = sql.prepare("SELECT totalHits FROM world_boss WHERE guildID = ?").get(guildID);
                finalHits = finalBossData ? (finalBossData.totalHits) : 1; 
            } catch (e) { finalHits = 1; }

            newEmbed.setTitle(`✥ تـمـت هزيـمـة الزعـيـم ${boss.name}`)
                .setDescription(
                    `✶ **معـلومـات الزعـيـم:**\n` +
                    `- الاسـم: **${boss.name}**\n` +
                    `- نقـاط الصحـة: **${boss.maxHP.toLocaleString()}**\n` +
                    `- هجمات متلـقـية: **${finalHits}**\n\n` +
                    `✶ **اعـلـى ضـرر:**\n` +
                    `${lbText}\n\n` +
                    `**صـاحـب الضربـة القاضيـة:**\n` +
                    `✬ ${member}`
                )
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
