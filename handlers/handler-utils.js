const { EmbedBuilder, PermissionsBitField } = require("discord.js");

// =========================================================
// 🌟 دالة حساب الرصيد الحر (للتحقق الخلفي فقط) 🌟
// المعادلة: (الكاش + البنك) - قيمة القرض المتبقي
// تستخدم في ملفات التحويل والرهان فقط، ولا تظهر للاعب
// =========================================================
function getFreeBalance(member, sql) {
    if (!sql || typeof sql.prepare !== 'function') return 0;
    
    // جلب الكاش والبنك
    const levelData = sql.prepare("SELECT mora, bank FROM levels WHERE user = ? AND guild = ?").get(member.id, member.guild.id);
    const currentMora = levelData ? (levelData.mora || 0) : 0;
    const currentBank = levelData ? (levelData.bank || 0) : 0;
    
    // حساب الثروة الكلية (كاش + بنك)
    const totalWealth = currentMora + currentBank;

    // جلب الدين المتبقي
    const loanData = sql.prepare("SELECT remainingAmount FROM user_loans WHERE userID = ? AND guildID = ?").get(member.id, member.guild.id);
    const debt = loanData ? loanData.remainingAmount : 0;

    // الرصيد الحر = الثروة الكلية - الدين
    const freeBalance = totalWealth - debt;
    
    // لا يمكن أن يكون السالب رصيداً متاحاً
    return Math.max(0, freeBalance);
}

// =========================================================
// 🌟 دالة رسالة الترقية (للعرض) 🌟
// تعرض الرصيد الكلي دائماً
// =========================================================
async function sendLevelUpMessage(interaction, member, newLevel, oldLevel, xpData, sql) {
     try {
         let customSettings = sql.prepare("SELECT * FROM settings WHERE guild = ?").get(interaction.guild.id);
         let channelLevel = sql.prepare("SELECT * FROM channel WHERE guild = ?").get(interaction.guild.id);
         let levelUpContent = null;
         let embed;

         if (customSettings && customSettings.lvlUpTitle) {
             function antonymsLevelUp(string) {
                 return string
                    .replace(/{member}/gi, `${member}`)
                    .replace(/{level}/gi, `${newLevel}`)
                    .replace(/{level_old}/gi, `${oldLevel}`)
                    .replace(/{xp}/gi, `${xpData.xp}`)
                    .replace(/{totalXP}/gi, `${xpData.totalXP}`)
                    // 🔥 إضافة: عرض المورا الكلية (القرض + الحر) بدون تفصيل
                    .replace(/{mora}/gi, `${(xpData.mora || 0).toLocaleString()}`); 
             }
             embed = new EmbedBuilder().setTitle(antonymsLevelUp(customSettings.lvlUpTitle)).setDescription(antonymsLevelUp(customSettings.lvlUpDesc.replace(/\\n/g, '\n'))).setColor(customSettings.lvlUpColor || "Random").setTimestamp();
             if (customSettings.lvlUpImage) { embed.setImage(antonymsLevelUp(customSettings.lvlUpImage)); }
             if (customSettings.lvlUpMention == 1) { levelUpContent = `${member}`; }
         } else {
             embed = new EmbedBuilder().setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) }).setColor("Random").setDescription(`**Congratulations** ${member}! You have now leveled up to **level ${newLevel}**`);
         }

         let channelToSend = interaction.channel;
         if (channelLevel && channelLevel.channel !== "Default") {
               channelToSend = interaction.guild.channels.cache.get(channelLevel.channel) || interaction.channel;
         }
         if (!channelToSend) return;

         const permissionFlags = channelToSend.permissionsFor(interaction.guild.members.me);
         if (permissionFlags.has(PermissionsBitField.Flags.SendMessages) && permissionFlags.has(PermissionsBitField.Flags.ViewChannel)) {
             await channelToSend.send({ content: levelUpContent, embeds: [embed] }).catch(e => console.error(`[LevelUp Send Error]: ${e.message}`));
         }
    } catch (err) {
         console.error(`[LevelUp Error]: ${err.message}`);
    }
}

module.exports = {
    sendLevelUpMessage,
    getFreeBalance 
};
