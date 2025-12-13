const { SlashCommandBuilder } = require("discord.js");
const { startDungeon } = require("../../handlers/dungeon-handler.js");

// خريطة لتخزين أوقات الكولداون (في الذاكرة)
const dungeonCooldowns = new Map();
const COOLDOWN_TIME = 3 * 60 * 60 * 1000; // 3 ساعات بالميلي ثانية
const OWNER_ID = "1145327691772481577"; // الآيدي الخاص بك

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
                    if (message.lastBotReply) return message.lastBotReply.edit(payload);
                    return message.channel.send(payload); 
                },
                followUp: async (payload) => message.channel.send(payload),
                update: async (payload) => {}, 
                deferReply: async () => {},    
                deferUpdate: async () => {}    
            };
        }

        const client = interactionOrMessage.client;
        const userId = interaction.user.id;

        // --- ⏳ التحقق من الكولداون ⏳ ---
        // إذا لم يكن المستخدم هو الأونر
        if (userId !== OWNER_ID) {
            const lastUsage = dungeonCooldowns.get(userId);
            const now = Date.now();

            if (lastUsage && (now - lastUsage) < COOLDOWN_TIME) {
                const timeLeft = COOLDOWN_TIME - (now - lastUsage);
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                
                const msg = { content: `⏳ **هدئ من روعك أيها المحارب!**\nيجب أن تستريح قبل فتح بوابة دانجون جديدة.\nالوقت المتبقي: **${hours} ساعة و ${minutes} دقيقة**.\n\n*💡 يمكنك الانضمام لدانجون شخص آخر في أي وقت!*`, ephemeral: true };
                
                if (isSlash && !interaction.replied) return await interaction.reply(msg);
                else return await interaction.followUp(msg);
            }
        }

        try {
            // تسجيل وقت الاستخدام الجديد (إذا نجح البدء)
            if (userId !== OWNER_ID) {
                dungeonCooldowns.set(userId, Date.now());
            }

            await startDungeon(interaction, client.sql);
        } catch (error) {
            console.error("[Dungeon Error]", error);
            // في حالة الخطأ، نزيل الكولداون لكي يحاول مرة أخرى
            dungeonCooldowns.delete(userId);
            
            const msg = { content: "❌ حدث خطأ غير متوقع في الدانجون.", ephemeral: true };
            if (isSlash && !interaction.replied) await interaction.reply(msg);
            else if (isSlash) await interaction.followUp(msg);
            else interactionOrMessage.reply(msg);
        }
    }
};
