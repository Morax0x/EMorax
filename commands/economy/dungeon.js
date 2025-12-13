const { SlashCommandBuilder } = require("discord.js");
const { startDungeon } = require("../../handlers/dungeon-handler.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dungeon')
        .setDescription('⚔️ ادخل الدانجون (فردي أو جماعي) وحارب وحوش الأنمي!')
        .setDMPermission(false),

    name: 'dungeon',
    aliases: ['دانجون', 'برج', 'dgn'],
    category: "Economy",
    description: "نظام الدانجون المتقدم (PvE)",

    async execute(interactionOrMessage, args) {
        // دعم السلاش والرسائل العادية
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction;

        if (isSlash) {
            interaction = interactionOrMessage;
        } else {
            const message = interactionOrMessage;
            interaction = {
                user: message.author,
                guild: message.guild,
                member: message.member,
                channel: message.channel,
                client: message.client,
                id: message.id,
                isChatInputCommand: false,
                reply: async (payload) => {
                    const msg = await message.reply(payload);
                    return msg;
                },
                editReply: async (payload) => {
                    // محاكاة تعديل الرد للرسائل العادية
                    if (message.lastBotReply) return message.lastBotReply.edit(payload);
                    return message.channel.send(payload); 
                },
                followUp: async (payload) => message.channel.send(payload),
                update: async (payload) => {}, // Placeholder
                deferReply: async () => {},    // Placeholder
                deferUpdate: async () => {}    // Placeholder
            };
        }

        const client = interactionOrMessage.client;
        
        try {
            await startDungeon(interaction, client.sql);
        } catch (error) {
            console.error("[Dungeon Error]", error);
            const msg = { content: "❌ حدث خطأ غير متوقع في الدانجون.", ephemeral: true };
            if (isSlash && !interaction.replied) await interaction.reply(msg);
            else if (isSlash) await interaction.followUp(msg);
            else interactionOrMessage.reply(msg);
        }
    }
};
