const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, Colors } = require('discord.js');

// دالة رسم الشريط (نفس المستخدمة في الهاندلر لتوحيد الشكل)
function createProgressBar(current, max, length = 18) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '🟥'.repeat(filled) + '⬛'.repeat(empty);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boss-control')
        .setDescription('التحكم الكامل في وحش العالم (للإدارة)')
        .addSubcommand(sub => 
            sub.setName('kill')
               .setDescription('قتل الوحش فوراً وإعلان النصر'))
        .addSubcommand(sub => 
            sub.setName('delete')
               .setDescription('حذف حدث الوحش وإلغاؤه تماماً'))
        .addSubcommand(sub => 
            sub.setName('set-hp')
               .setDescription('تغيير نقاط صحة الوحش الحالية')
               .addIntegerOption(opt => opt.setName('amount').setDescription('الكمية الجديدة').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('edit')
               .setDescription('تعديل بيانات الوحش الحالي')
               .addStringOption(opt => opt.setName('name').setDescription('الاسم الجديد'))
               .addStringOption(opt => opt.setName('image').setDescription('رابط الصورة الجديد'))),

    async execute(interaction) {
        // التحقق من الصلاحية
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ هذا الأمر للمسؤولين فقط.', ephemeral: true });
        }

        const sql = interaction.client.sql;
        const guildID = interaction.guild.id;
        const subcommand = interaction.options.getSubcommand();

        // جلب الوحش الحالي
        const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);

        if (!boss) {
            return interaction.reply({ content: "❌ لا يوجد وحش نشط حالياً للتحكم به.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // محاولة جلب رسالة الوحش للتعديل عليها
        let bossMsg;
        try {
            const channel = await interaction.guild.channels.fetch(boss.channelID);
            bossMsg = await channel.messages.fetch(boss.messageID);
        } catch (e) {
            // إذا الرسالة محذوفة، نقوم بتصفير الداتابيس فقط
            if (subcommand === 'delete' || subcommand === 'kill') {
                sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
                return interaction.editReply("⚠️ لم يتم العثور على رسالة الوحش، ولكن تم إغلاق الحدث في قاعدة البيانات.");
            }
            return interaction.editReply("❌ لا يمكن العثور على رسالة الوحش الأصلية (ربما حذفت).");
        }

        // --- تنفيذ الأوامر ---

        if (subcommand === 'kill') {
            // 💀 قتل الوحش
            const killEmbed = EmbedBuilder.from(bossMsg.embeds[0])
                .setTitle(`💀 **تم القضاء على ${boss.name} بأمر إداري!**`)
                .setDescription(`🎉 **النصر!**\nتدخلت القوى العليا وقضت على الوحش.\nتم إنهاء المعركة فوراً.`)
                .setColor(Colors.Gold)
                .setFields([]); // إزالة الحقول

            await bossMsg.edit({ embeds: [killEmbed], components: [] });
            
            // تحديث الداتابيس
            sql.prepare("UPDATE world_boss SET currentHP = 0, active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);

            await interaction.editReply("✅ تم قتل الوحش وإنهاء الحدث.");
        } 
        
        else if (subcommand === 'delete') {
            // 🗑️ حذف الحدث
            try {
                await bossMsg.delete();
            } catch(e) {}

            sql.prepare("UPDATE world_boss SET active = 0 WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_cooldowns WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);

            await interaction.editReply("✅ تم حذف الوحش وإلغاء الحدث.");
        }

        else if (subcommand === 'set-hp') {
            // ❤️ تغيير الصحة
            let newHP = interaction.options.getInteger('amount');
            if (newHP < 0) newHP = 0;
            if (newHP > boss.maxHP) newHP = boss.maxHP; // اختياري: هل تسمح بزيادة عن الماكس؟ هنا حددتها بالماكس

            sql.prepare("UPDATE world_boss SET currentHP = ? WHERE guildID = ?").run(newHP, guildID);

            // تحديث شكل الإيمبد
            const hpPercent = Math.floor((newHP / boss.maxHP) * 100);
            const progressBar = createProgressBar(newHP, boss.maxHP, 18);
            
            const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
                .setDescription(bossMsg.embeds[0].description.replace(/📊 **الحالة:**.*?\n.*/s, `📊 **الحالة:** ${hpPercent}% متبقي\n${progressBar}`));
            
            // تحديث حقل الصحة
            const fields = newEmbed.data.fields;
            if (fields && fields[0]) {
                fields[0].value = `**${newHP.toLocaleString()}** / ${boss.maxHP.toLocaleString()} HP`;
            }
            newEmbed.setFields(fields);

            await bossMsg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ تم تغيير صحة الوحش إلى **${newHP}**.`);
        }

        else if (subcommand === 'edit') {
            // ✏️ تعديل الاسم أو الصورة
            const newName = interaction.options.getString('name') || boss.name;
            const newImage = interaction.options.getString('image') || boss.image;

            sql.prepare("UPDATE world_boss SET name = ?, image = ? WHERE guildID = ?").run(newName, newImage, guildID);

            const newEmbed = EmbedBuilder.from(bossMsg.embeds[0])
                .setTitle(`👹 **WORLD BOSS: ${newName}**`);
            
            if (newImage) newEmbed.setImage(newImage);

            await bossMsg.edit({ embeds: [newEmbed] });
            await interaction.editReply("✅ تم تحديث بيانات الوحش.");
        }
    }
};
