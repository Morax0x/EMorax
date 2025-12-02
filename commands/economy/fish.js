const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const path = require('path');

// استخدام المسار الجذري
const rootDir = process.cwd();
const fishingConfig = require(path.join(rootDir, 'json', 'fishing-config.json'));

// استخراج البيانات
const fishItems = fishingConfig.fishItems;
const rodsConfig = fishingConfig.rods;
const boatsConfig = fishingConfig.boats;
const locationsConfig = fishingConfig.locations;

// 🔒 آيدي المالك (الوحيد الذي يتجاهل الكولداون)
const OWNER_ID = "1145327691772481577";
const EMOJI_MORA = '<:mora:1435647151349698621>';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('صيد')
        .setDescription('ابدأ رحلة الصيد (ميني جيم).'),

    name: 'fish',
    aliases: ['صيد', 'ص', 'fishing'],
    category: "Economy",
    description: "صيد الأسماك التفاعلي.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        const user = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
        const guild = isSlash ? interactionOrMessage.guild : interactionOrMessage.guild;
        const client = interactionOrMessage.client;
        const sql = client.sql;

        // دالة الرد الموحدة
        const reply = async (payload) => {
            if (isSlash) {
                if (interactionOrMessage.deferred || interactionOrMessage.replied) return interactionOrMessage.editReply(payload);
                return interactionOrMessage.reply({ ...payload, fetchReply: true }); 
            }
            return interactionOrMessage.reply(payload);
        };

        // 1. جلب بيانات المستخدم
        let userData = client.getLevel.get(user.id, guild.id);
        if (!userData) {
            userData = { 
                ...client.defaultData, 
                user: user.id, 
                guild: guild.id, 
                rodLevel: 1, 
                boatLevel: 1,
                currentLocation: 'beach',
                lastFish: 0 
            };
            client.setLevel.run(userData);
        }

        // تجهيز بيانات العدة
        const currentRod = rodsConfig.find(r => r.level === (userData.rodLevel || 1)) || rodsConfig[0];
        const currentBoat = boatsConfig.find(b => b.level === (userData.boatLevel || 1)) || boatsConfig[0];
        const locationId = userData.currentLocation || 'beach';
        const currentLocation = locationsConfig.find(l => l.id === locationId) || locationsConfig[0];

        // 2. التحقق من الكولداون
        // (نخصم سرعة القارب من الكولداون الأساسي للسنارة)
        let cooldown = currentRod.cooldown - (currentBoat.speed_bonus || 0);
        if (cooldown < 10000) cooldown = 10000; // الحد الأدنى 10 ثواني

        const lastFish = userData.lastFish || 0;
        const now = Date.now();

        if (user.id !== OWNER_ID && (now - lastFish < cooldown)) {
            const remaining = lastFish + cooldown - now;
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            return reply({ content: `⏳ | أنت متعب! ارتح قليلاً.\nالوقت المتبقي: **${minutes}د ${seconds}ث**` });
        }

        // 3. واجهة الانتظار (قبل الرمي)
        const startEmbed = new EmbedBuilder()
            .setTitle(`🎣 رحلة صيد: ${currentLocation.name}`)
            .setColor(Colors.Blue)
            .setDescription(`**عدتك الحالية:**\n🎣 **السنارة:** ${currentRod.name}\n🚤 **القارب:** ${currentBoat.name}\n🌊 **المنطقة:** ${currentLocation.name}`)
            .setFooter({ text: "اضغط الزر أدناه لرمي السنارة وانتظر السمكة..." });

        const startRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cast_rod').setLabel('رمي السنارة').setStyle(ButtonStyle.Primary).setEmoji('🎣')
        );

        const msg = await reply({ embeds: [startEmbed], components: [startRow] });

        // إنشاء مستقبل للتفاعل (Collector)
        const filter = i => i.user.id === user.id && i.customId === 'cast_rod';
        const collector = msg.createMessageComponentCollector({ filter, time: 30000, max: 1 });

        collector.on('collect', async i => {
            await i.deferUpdate();

            // مرحلة الانتظار (Waiting...)
            const waitingEmbed = new EmbedBuilder()
                .setTitle("🌊 السنارة في الماء...")
                .setDescription("انتظر... لا تسحب السنارة حتى تشعر بالاهتزاز!")
                .setColor(Colors.Grey)
                .setImage("https://i.postimg.cc/Wz0g0Zg0/fishing.png"); // صورة صيد ثابتة

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pull_rod').setLabel('...').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );

            await i.editReply({ embeds: [waitingEmbed], components: [disabledRow] });

            // وقت عشوائي بين 2 إلى 5 ثواني
            const waitTime = Math.floor(Math.random() * 3000) + 2000;

            setTimeout(async () => {
                // مرحلة السحب (PULL!)
                const biteEmbed = new EmbedBuilder()
                    .setTitle("‼️ سمكة! اسحب الآن!")
                    .setDescription("اضغط الزر بسرعة قبل أن تهرب!")
                    .setColor(Colors.Green);

                const pullRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('pull_rod_now').setLabel('اسحب السنارة!').setStyle(ButtonStyle.Success).setEmoji('🦈')
                );

                await i.editReply({ embeds: [biteEmbed], components: [pullRow] });

                // مستقبل للزر الثاني (السحب)
                const pullFilter = j => j.user.id === user.id && j.customId === 'pull_rod_now';
                const pullCollector = msg.createMessageComponentCollector({ filter: pullFilter, time: 3000, max: 1 }); // معه 3 ثواني بس

                pullCollector.on('collect', async j => {
                    await j.deferUpdate();
                    
                    // --- منطق الصيد (نفس الحسابات السابقة) ---
                    const fishCount = Math.floor(Math.random() * currentRod.max_fish) + 1;
                    let caughtFish = [];
                    let totalValue = 0;

                    for (let k = 0; k < fishCount; k++) {
                        const roll = Math.random() * 100 + (currentRod.luck_bonus || 0);
                        let rarity = 1;
                        if (roll > 95) rarity = 6;       
                        else if (roll > 85) rarity = 5;  
                        else if (roll > 70) rarity = 4;  
                        else if (roll > 50) rarity = 3;  
                        else if (roll > 30) rarity = 2;  
                        else rarity = 1;                 

                        // الفلترة حسب المنطقة (Location Logic)
                        // نصيد فقط الأسماك المتوفرة في المنطقة الحالية (أو أقل منها ندرة)
                        // إذا لم نجد سمكة في هذه الندرة في هذه المنطقة، نقلل الندرة
                        let possibleFish = [];
                        while (possibleFish.length === 0 && rarity >= 1) {
                             possibleFish = fishItems.filter(f => f.rarity === rarity); // (مؤقتاً كل الأسماك، يمكن تخصيصها حسب currentLocation.fish_types)
                             if (possibleFish.length === 0) rarity--;
                        }
                        
                        // تحسين: فلترة حسب المنطقة إذا أردت تفعيلها بدقة
                        // const allowedRarities = currentLocation.fish_types; // مصفوفة [1, 2]
                        // if (!allowedRarities.includes(rarity)) ...

                        if (possibleFish.length > 0) {
                            const fish = possibleFish[Math.floor(Math.random() * possibleFish.length)];
                            
                            sql.prepare(`
                                INSERT INTO user_portfolio (guildID, userID, itemID, quantity) 
                                VALUES (?, ?, ?, 1) 
                                ON CONFLICT(guildID, userID, itemID) 
                                DO UPDATE SET quantity = quantity + 1
                            `).run(guild.id, user.id, fish.id);

                            caughtFish.push(fish);
                            totalValue += fish.price;
                        }
                    }

                    // تحديث البيانات
                    userData.lastFish = Date.now();
                    userData.mora = (userData.mora || 0) + totalValue;
                    client.setLevel.run(userData);

                    // عرض النتيجة
                    const summary = {};
                    caughtFish.forEach(f => {
                        summary[f.name] = summary[f.name] ? { count: summary[f.name].count + 1, emoji: f.emoji, rarity: f.rarity } : { count: 1, emoji: f.emoji, rarity: f.rarity };
                    });

                    let description = "✶ قمـت بصيـد:\n";
                    for (const [name, info] of Object.entries(summary)) {
                        let rarityStar = "";
                        if (info.rarity >= 5) rarityStar = "🌟"; else if (info.rarity === 4) rarityStar = "✨";
                        description += `✬ **${info.count}x** ${info.emoji} ${name} ${rarityStar}\n`;
                    }
                    description += `\n✶ قيـمـة الصيد: \`${totalValue.toLocaleString()}\` ${EMOJI_MORA}`;

                    const resultEmbed = new EmbedBuilder()
                        .setTitle(`🎣 صيد موفق!`)
                        .setDescription(description)
                        .setColor(Colors.Green)
                        .setThumbnail('https://i.postimg.cc/Wz0g0Zg0/fishing.png')
                        .setFooter({ text: "تم إضافة المبلغ لرصيدك" });

                    await j.editReply({ embeds: [resultEmbed], components: [] });
                });

                pullCollector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        // انتهى الوقت ولم يضغط
                        const failEmbed = new EmbedBuilder()
                            .setTitle("💨 هربت السمكة!")
                            .setDescription("تأخرت في السحب! حاول مرة أخرى لاحقاً.")
                            .setColor(Colors.Red);
                        
                        // نحدث الوقت حتى لو فشل (عشان الكولداون)
                        userData.lastFish = Date.now();
                        client.setLevel.run(userData);

                        await i.editReply({ embeds: [failEmbed], components: [] }).catch(() => {});
                    }
                });

            }, waitTime);
        });
    }
};
