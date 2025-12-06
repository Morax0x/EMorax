// هذا الكود في ملف commands/admin/set-shop-log.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-shop-log')
        .setDescription('تعيين قناة سجلات المتجر')
        .addChannelOption(option => option.setName('channel').setDescription('القناة').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    name: 'set-shop-log',
    async execute(interaction, args) {
        const channel = interaction.options ? interaction.options.getChannel('channel') : interaction.guild.channels.cache.get(args[0]);
        if (!channel) return interaction.reply("حدد القناة.");
        
        interaction.client.sql.prepare("INSERT OR IGNORE INTO settings (guild) VALUES (?)").run(interaction.guild.id);
        interaction.client.sql.prepare("UPDATE settings SET shopLogChannelID = ? WHERE guild = ?").run(channel.id, interaction.guild.id);
        
        return interaction.reply(`✅ تم تعيين قناة سجلات المتجر: ${channel}`);
    }
};
