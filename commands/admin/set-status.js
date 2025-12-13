const { SlashCommandBuilder, ActivityType, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('تغيير-الحالة')
        .setDescription('تغيير نشاط البوت (الفقاعة) وحالة الاتصال (اللون).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(option =>
            option.setName('النوع')
                .setDescription('نوع النشاط (الفقاعة أو يلعب...)')
                .setRequired(true)
                .addChoices(
                    { name: 'Custom (فقاعة كلام 💬)', value: 'Custom' },
                    { name: 'Playing (يلعب 🎮)', value: 'Playing' },
                    { name: 'Watching (يشاهد 📺)', value: 'Watching' },
                    { name: 'Listening (يستمع 🎧)', value: 'Listening' },
                    { name: 'Competing (يتنافس 🏆)', value: 'Competing' },
                    { name: 'Streaming (بث مباشر 🟣)', value: 'Streaming' }
                ))
        .addStringOption(option =>
            option.setName('النص')
                .setDescription('الكلام الذي يظهر')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('الوضع')
                .setDescription('لون الدائرة (أخضر، أصفر، أحمر)')
                .setRequired(false)
                .addChoices(
                    { name: 'Online (متصل 🟢)', value: 'online' },
                    { name: 'Idle (خامل 🟡)', value: 'idle' },
                    { name: 'Do Not Disturb (ممنوع الإزعاج 🔴)', value: 'dnd' },
                    { name: 'Invisible (مخفي ⚫)', value: 'invisible' }
                )),

    name: 'set-status',
    category: "Admin",

    async execute(interaction) {
        if (!interaction.isChatInputCommand) return;

        const typeStr = interaction.options.getString('النوع');
        const content = interaction.options.getString('النص');
        const statusStr = interaction.options.getString('الوضع') || 'online'; // الافتراضي متصل

        let activityData;

        // تجهيز بيانات النشاط
        if (typeStr === 'Custom') {
            activityData = {
                name: content, 
                type: ActivityType.Custom, 
                state: content 
            };
        } else if (typeStr === 'Streaming') {
            activityData = {
                name: content,
                type: ActivityType.Streaming,
                url: "https://www.twitch.tv/discord"
            };
        } else {
            let type;
            switch (typeStr) {
                case 'Playing': type = ActivityType.Playing; break;
                case 'Watching': type = ActivityType.Watching; break;
                case 'Listening': type = ActivityType.Listening; break;
                case 'Competing': type = ActivityType.Competing; break;
            }
            activityData = { name: content, type: type };
        }

        // 1. تطبيق النشاط + اللون فوراً
        interaction.client.user.setPresence({
            activities: [activityData],
            status: statusStr
        });

        // 2. حفظ الإعدادات في قاعدة البيانات (لضمان البقاء بعد الريستارت)
        const sql = interaction.client.sql;
        const guildID = interaction.guild.id;

        // نحفظ البيانات في جدول settings (سنستخدم guildID الحالي كمرجع لحفظ الإعداد العام للبوت)
        try {
            sql.prepare("INSERT OR IGNORE INTO settings (guild) VALUES (?)").run(guildID);
            
            // تحديث الأعمدة الخاصة بالحالة (تأكد أن الأعمدة موجودة كما أضفناها سابقاً)
            sql.prepare(`
                UPDATE settings 
                SET savedStatusType = ?, 
                    savedStatusText = ? 
                WHERE guild = ?
            `).run(typeStr, content, guildID);
            
            // يمكننا أيضاً حفظ "الوضع" (online/idle...) إذا أردت، لكن حالياً سنكتفي بالنشاط
            // إذا أردت حفظ اللون أيضاً، ستحتاج لإضافة عمود savedStatusColor
        } catch (e) {
            console.error("Failed to save status to DB:", e);
        }

        await interaction.reply({ 
            content: `✅ **تم التحديث والحفظ!**\n- النشاط: **${typeStr}**\n- النص: \`${content}\`\n- اللون: **${statusStr}**`, 
            ephemeral: true 
        });
    },
};
