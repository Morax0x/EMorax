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
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ للمسؤولين فقط.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const hp = interaction.options.getInteger('hp');
        const image = interaction.options.getString('image') || null;
        const guildID = interaction.guild.id;
        const channelID = interaction.channel.id;
        const sql = interaction.client.sql;

        // التحقق من وحش سابق
        const activeBoss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
        if (activeBoss) return interaction.reply({ content: `❌ يوجد وحش نشط بالفعل!`, ephemeral: true });

        await interaction.deferReply();

        // --- تصميم الـ PvP بالضبط ---
        const progressBar = '🟥'.repeat(20); 
        
        const embed = new EmbedBuilder()
            .setTitle('👹 مـعـركـة زعـيـم 👹') // نفس ستايل عنوان PvP
            .setColor(Colors.DarkRed)
            .setImage(image)
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/1041/1041891.png') // صورة جانبية ثابتة
            .setDescription(
                `**${name}** يظهر في ساحة المعركة!\n\n` +
                `✬ **الـحـالـة الـصـحـيـة:**\n` +
                `${progressBar} **100%**\n` +
                `╰ **${hp.toLocaleString()}** / ${hp.toLocaleString()} HP\n\n` +
                `✬ **سـجـل الـمـعـركـة:**\n` +
                `╰ بانتظار الهجوم الأول...`
            );

        // الأزرار
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );

        const message = await interaction.editReply({ embeds: [embed], components: [row] });

        // الحفظ
        try {
            sql.prepare(`INSERT OR REPLACE INTO world_boss (guildID, currentHP, maxHP, name, image, active, messageID, channelID, lastLog) VALUES (?, ?, ?, ?, ?, 1, ?, ?, '[]')`).run(guildID, hp, hp, name, image, message.id, channelID);
            sql.prepare("DELETE FROM boss_cooldowns WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);
            await interaction.followUp({ content: "✅ تم الاستدعاء.", ephemeral: true });
        } catch (error) { console.error(error); }
    },
};
