const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spawn-boss')
        .setDescription('استدعاء وحش العالم (للإدارة فقط)')
        .addStringOption(option => 
            option.setName('name').setDescription('اسم الوحش').setRequired(true))
        .addIntegerOption(option => 
            option.setName('hp').setDescription('نقاط حياة الوحش (HP)').setRequired(true))
        .addStringOption(option => 
            option.setName('image').setDescription('رابط صورة الوحش').setRequired(false)),

    async execute(interaction) {
        // التحقق من الصلاحية
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ هذا الأمر للمسؤولين فقط.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const hp = interaction.options.getInteger('hp');
        const image = interaction.options.getString('image') || null;
        const guildID = interaction.guild.id;
        const channelID = interaction.channel.id;

        const sql = interaction.client.sql;

        // التحقق من وجود وحش حالي
        const activeBoss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
        if (activeBoss) {
            return interaction.reply({ content: `❌ يوجد وحش نشط بالفعل (${activeBoss.name})! يجب القضاء عليه أولاً.`, ephemeral: true });
        }

        await interaction.deferReply();

        // 1. تجهيز الإيمبد الأولي (نفس تصميم الهاندلر)
        const progressBar = '🟥'.repeat(18); // شريط كامل في البداية
        const embed = new EmbedBuilder()
            .setTitle(`👹 **WORLD BOSS: ${name}**`)
            .setDescription(`⚠️ **تحذير:** وحش أسطوري يهاجم المنطقة! تعاونوا لهزيمته.\n\n` + 
                            `📊 **الحالة:** 100% متبقي\n` +
                            `${progressBar}`)
            .setColor(Colors.DarkRed)
            .setImage(image)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/1041/1041891.png')
            .addFields(
                { name: `🩸 الصحة`, value: `**${hp.toLocaleString()}** / ${hp.toLocaleString()}`, inline: true },
                { name: `🛡️ سجل المعركة`, value: "لا يوجد ضربات بعد...", inline: false }
            )
            .setFooter({ text: "استخدم الأزرار أدناه للمشاركة في القتال!" })
            .setTimestamp();

        // 2. تجهيز الأزرار الثلاثة المطلوبة
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );

        // 3. إرسال الرسالة
        const message = await interaction.editReply({ embeds: [embed], components: [row] });

        // 4. حفظ الوحش في قاعدة البيانات
        try {
            sql.prepare(`
                INSERT OR REPLACE INTO world_boss (guildID, currentHP, maxHP, name, image, active, messageID, channelID, lastLog)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, '[]')
            `).run(guildID, hp, hp, name, image, message.id, channelID);
            
            // تصفير جداول السجل والكولداون للمعركة الجديدة
            sql.prepare("DELETE FROM boss_cooldowns WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);

            await interaction.followUp({ content: "✅ **تم استدعاء الوحش بنجاح!**", ephemeral: true });

        } catch (error) {
            console.error(error);
            await interaction.followUp({ content: "❌ حدث خطأ أثناء حفظ الوحش في قاعدة البيانات.", ephemeral: true });
        }
    },
};
