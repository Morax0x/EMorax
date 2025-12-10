const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const SQLite = require("better-sqlite3");
const path = require('path');

// استدعاء ملف إعدادات الصيد لحساب الكولداون الديناميكي
const rootDir = process.cwd();
let fishingConfig = { rods: [], boats: [] };
try {
    fishingConfig = require(path.join(rootDir, 'json', 'fishing-config.json'));
} catch (e) {
    console.warn("[GameTime] Could not load fishing-config.json, using defaults.");
    // قيم افتراضية في حال فشل التحميل
    fishingConfig.rods = [{ level: 1, cooldown: 300000 }]; 
    fishingConfig.boats = [{ level: 1, speed_bonus: 0 }];
}

const sql = new SQLite('./mainDB.sqlite');

const EMOJI_READY = '🟢';
const EMOJI_WAIT = '🔴';

function formatTimeSimple(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// قائمة الأوامر الثابتة
const COMMANDS_TO_CHECK = [
    { name: 'daily', db_column: 'lastDaily', cooldown: 22 * 60 * 60 * 1000, label: 'راتب' },
    // تم إزالة فوائد البنك من هنا
    { name: 'work', db_column: 'lastWork', cooldown: 1 * 60 * 60 * 1000, label: 'عمل' },
    { name: 'rob', db_column: 'lastRob', cooldown: 1 * 60 * 60 * 1000, label: 'سرقة' },
    { name: 'rps', db_column: 'lastRPS', cooldown: 1 * 60 * 60 * 1000, label: 'حجرة' },
    { name: 'guess', db_column: 'lastGuess', cooldown: 1 * 60 * 60 * 1000, label: 'تخمين' },
    { name: 'roulette', db_column: 'lastRoulette', cooldown: 1 * 60 * 60 * 1000, label: 'روليت' },
    { name: 'emoji', db_column: 'lastMemory', cooldown: 1 * 60 * 60 * 1000, label: 'ايموجي' }, // ✅ تمت الإضافة
    { name: 'arrange', db_column: 'lastArrange', cooldown: 1 * 60 * 60 * 1000, label: 'رتب' }, // ✅ تمت إضافة رتب هنا
    { name: 'pvp', db_column: 'lastPVP', cooldown: 5 * 60 * 1000, label: 'تحدي' },
    { name: 'transfer', db_column: 'lastTransfer', cooldown: 5 * 60 * 1000, label: 'تحويل' },
    { name: 'deposit', db_column: 'lastDeposit', cooldown: 1 * 60 * 60 * 1000, label: 'إيداع' },
    // الصيد (Fish) سيتم حسابه ديناميكياً في الأسفل
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('وقت')
        .setDescription('يعرض الوقت المتبقي لاستخدام أوامر الاقتصاد.')
        .addUserOption(option =>
            option.setName('المستخدم')
            .setDescription('عرض أوقات مستخدم آخر (اختياري)')
            .setRequired(false)),

    name: 'gametime',
    aliases: ['وقت', 'وقت الالعاب', 'cooldown', 'cd'],
    category: "Economy",
    description: 'يعرض الوقت المتبقي لاستخدام أوامر الاقتصاد.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, client, guild;
        let targetUser;

        try {
            if (isSlash) {
                interaction = interactionOrMessage;
                client = interaction.client;
                guild = interaction.guild;
                targetUser = interaction.options.getUser('المستخدم') || interaction.user;
                await interaction.deferReply();
            } else {
                message = interactionOrMessage;
                client = message.client;
                guild = message.guild;
                targetUser = message.author;
            }

            const reply = async (payload) => {
                if (payload.ephemeral) {
                    delete payload.ephemeral;
                    payload.flags = [MessageFlags.Ephemeral];
                }
                if (isSlash) {
                    return interaction.editReply(payload);
                } else {
                    return message.channel.send(payload);
                }
            };

            const getScore = client.getLevel;
            let data = getScore.get(targetUser.id, guild.id);
            if (!data) {
                data = { ...client.defaultData, user: targetUser.id, guild: guild.id };
            }

            const now = Date.now();
            const descriptionLines = [];

            // 1. حساب الأوامر الثابتة
            for (const cmd of COMMANDS_TO_CHECK) {
                // تأكد من وجود العمود في الداتابيس، وإلا اعتبر القيمة 0
                const lastUsed = data[cmd.db_column] || 0;
                const cooldownAmount = cmd.cooldown;
                const timeLeft = lastUsed + cooldownAmount - now;

                if (timeLeft > 0) {
                    descriptionLines.push(`${EMOJI_WAIT} **${cmd.label}**: \`${formatTimeSimple(timeLeft)}\``);
                } else {
                    descriptionLines.push(`${EMOJI_READY} **${cmd.label}**`);
                }
            }

            // 2. 🎣 حساب كولداون الصيد (ديناميكي)
            const userRodLevel = data.rodLevel || 1;
            const userBoatLevel = data.boatLevel || 1;

            const currentRod = fishingConfig.rods.find(r => r.level === userRodLevel) || fishingConfig.rods[0];
            const currentBoat = fishingConfig.boats.find(b => b.level === userBoatLevel) || fishingConfig.boats[0];

            let fishCooldown = currentRod.cooldown - (currentBoat.speed_bonus || 0);
            if (fishCooldown < 10000) fishCooldown = 10000;

            const lastFish = data.lastFish || 0;
            const fishTimeLeft = lastFish + fishCooldown - now;

            if (fishTimeLeft > 0) {
                descriptionLines.push(`${EMOJI_WAIT} **صيد**: \`${formatTimeSimple(fishTimeLeft)}\``);
            } else {
                descriptionLines.push(`${EMOJI_READY} **صيد**`);
            }

            const embed = new EmbedBuilder()
                .setTitle('⏱️ وقـت الألعـاب')
                .setColor("Random")
                .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
                .setDescription(descriptionLines.join('\n'))
                .setImage('https://i.postimg.cc/7hhxXX8h/ec6f09156c21ff5df643e807a859d3e0.gif')
                .setTimestamp();

            await reply({ embeds: [embed] });

        } catch (error) {
            console.error("Error in gametime command:", error);
            const errorPayload = { content: "حدث خطأ أثناء جلب الأوقات.", flags: [MessageFlags.Ephemeral] };
            if (isSlash) {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply(errorPayload);
                }
            } else {
                message.reply(errorPayload.content);
            }
        }
    }
};
