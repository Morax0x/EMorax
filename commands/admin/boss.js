const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, PermissionsBitField } = require('discord.js');

// دالة رسم الشريط (التصميم الجديد █ ░)
function createProgressBar(current, max, length = 10) {
    const percent = Math.max(0, Math.min(1, current / max));
    const filled = Math.floor(percent * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spawn-boss')
        .setDescription('استدعاء وحش العالم (للإدارة فقط)')
        .addStringOption(option => 
            option.setName('name').setDescription('اسم الوحش').setRequired(true))
        .addIntegerOption(option => 
            option.setName('hp').setDescription('نقاط حياة الوحش (HP)').setRequired(true))
        .addStringOption(option => 
            option.setName('image').setDescription('رابط الصورة الكبيرة (اختياري)').setRequired(false))
        .addStringOption(option => 
            option.setName('thumbnail').setDescription('رابط الصورة المصغرة (اختياري)').setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ للمسؤولين فقط.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const hp = interaction.options.getInteger('hp');
        const image = interaction.options.getString('image') || null;
        const thumbnail = interaction.options.getString('thumbnail') || null;
        const guildID = interaction.guild.id;
        const channelID = interaction.channel.id;
        const sql = interaction.client.sql;

        const activeBoss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(guildID);
        if (activeBoss) return interaction.reply({ content: `❌ يوجد وحش نشط بالفعل!`, ephemeral: true });

        await interaction.deferReply();

        // تصميم الشريط الجديد
        const progressBar = createProgressBar(hp, hp, 12); 
        
        const embed = new EmbedBuilder()
            .setTitle(`مـعـركـة ضــد الزعــيـم ${name}`)
            .setColor(Colors.DarkRed)
            .setDescription(
                `✬ ظـهـر زعـيـم في السـاحـة تـعانـوا عـلـى قتاله واكسبوا الجوائـز !\n\n` +
                `✬ **نـقـاط صـحـة الزعـيـم:**\n` +
                `${progressBar} **100%**\n` +
                `╰ **${hp.toLocaleString()}** / ${hp.toLocaleString()} HP\n\n` +
                `✬ **سـجـل الـمـعـركـة:**\n` +
                `╰ بانتظار الهجوم الأول...`
            );

        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);

        // الأزرار
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('boss_attack').setLabel('هـجـوم').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('boss_skill_menu').setLabel('مـهـارة').setStyle(ButtonStyle.Primary).setEmoji('✨'),
            new ButtonBuilder().setCustomId('boss_status').setStyle(ButtonStyle.Secondary).setEmoji('❗')
        );

        const message = await interaction.editReply({ embeds: [embed], components: [row] });

        try {

            sql.prepare(`INSERT OR REPLACE INTO world_boss (guildID, currentHP, maxHP, name, image, active, messageID, channelID, lastLog) VALUES (?, ?, ?, ?, ?, 1, ?, ?, '[]')`).run(guildID, hp, hp, name, image || thumbnail, message.id, channelID);
            
            // *تلميح:* إذا أردت حفظ الصورتين، نحتاج تعديل الجدول، لكن سأجعل الكود يستخدم الصورة المتوفرة.
            
            sql.prepare("DELETE FROM boss_cooldowns WHERE guildID = ?").run(guildID);
            sql.prepare("DELETE FROM boss_leaderboard WHERE guildID = ?").run(guildID);
            await interaction.followUp({ content: "✅ تم الاستدعاء.", ephemeral: true });
        } catch (error) { console.error(error); }
    },
};
