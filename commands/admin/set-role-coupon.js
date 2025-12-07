const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-role-coupon')
        .setDescription('تعيين كوبون خصم خاص برتبة معينة (يتجدد كل 15 يوم)')
        .addRoleOption(option => 
            option.setName('role')
                .setDescription('الرتبة أو العرق')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('discount')
                .setDescription('نسبة الخصم %')
                .setMinValue(1)
                .setMaxValue(99)
                .setRequired(true)),

    async execute(interaction, args) {
        // التحقق من الصلاحيات (أدمن فقط)
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ **ليس لديك صلاحية لاستخدام هذا الأمر.**", flags: [MessageFlags.Ephemeral] });
        }

        const role = interaction.options.getRole('role');
        const discount = interaction.options.getInteger('discount');
        const sql = interaction.client.sql;

        // حفظ الإعدادات في الداتابيس
        sql.prepare("INSERT OR REPLACE INTO role_coupons_config (guildID, roleID, discountPercent) VALUES (?, ?, ?)").run(interaction.guild.id, role.id, discount);

        return interaction.reply({ 
            content: `✅ **تم إعداد الكوبون بنجاح!**\n\n🎭 **الرتبة:** ${role}\n📉 **الخصم:** ${discount}%\n⏳ **التجديد:** تلقائياً كل 15 يوم لكل عضو يحمل الرتبة.`,
            flags: [MessageFlags.Ephemeral] 
        });
    }
};
