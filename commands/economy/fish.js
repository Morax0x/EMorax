const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const path = require('path');

// استدعاء ملفات الإعدادات
const rootDir = process.cwd();
const fishingConfig = require(path.join(rootDir, 'json', 'fishing-config.json'));

// استدعاء دوال الـ PvP
let pvpCore = {};
try {
    pvpCore = require('../../handlers/pvp-core.js'); 
} catch (e) {
    console.warn("⚠️ Warning: pvp-core.js not found. Using default values for fishing combat.");
    pvpCore.getWeaponData = () => null;
    pvpCore.getUserActiveSkill = () => null;
}

// استخراج البيانات
const fishItems = fishingConfig.fishItems;
const rodsConfig = fishingConfig.rods;
const boatsConfig = fishingConfig.boats;
const locationsConfig = fishingConfig.locations;
const monstersConfig = fishingConfig.monsters || [];

// 🔒 آيدي المالك
const OWNER_ID = "1145327691772481577";
const EMOJI_MORA = '<:mora:1435647151349698621>';

// 🎨 قائمة الألوان المتاحة للعبة المصغرة
const COLOR_GAME_OPTIONS = [
    { id: 'red', emoji: '🔴', label: 'أحمر' },
    { id: 'blue', emoji: '🔵', label: 'أزرق' },
    { id: 'green', emoji: '🟢', label: 'أخضر' },
    { id: 'yellow', emoji: '🟡', label: 'أصفر' },
    { id: 'purple', emoji: '🟣', label: 'بنفسجي' },
    { id: 'white', emoji: '⚪', label: 'أبيض' },
    { id: 'black', emoji: '⚫', label: 'أسود' },
    { id: 'orange', emoji: '🟠', label: 'برتقالي' },
    { id: 'brown', emoji: '🟤', label: 'بني' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('صيد')
        .setDescription('ابـدأ رحـلـة صيد'),

    name: 'fish',
    aliases: ['صيد', 'ص', 'fishing'],
    category: "Economy",
    description: "صيد الأسماك التفاعلي مع مواجهات وحوش.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        const user = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
        const guild = isSlash ? interactionOrMessage.guild : interactionOrMessage.guild;
        const client = interactionOrMessage.client;
        const sql = client.sql;

        const reply = async (payload) => {
            if (payload.ephemeral) {
                delete payload.ephemeral;
                payload.flags = [MessageFlags.Ephemeral];
            }
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

        // التحقق من الجرح
        const now = Date.now();
        const woundedDebuff = sql.prepare("SELECT * FROM user_buffs WHERE userID = ? AND guildID = ? AND buffType = 'pvp_wounded' AND expiresAt > ?").get(user.id, guild.id, now);
        if (woundedDebuff) {
            const minutesLeft = Math.ceil((woundedDebuff.expiresAt - now) / 60000);
            return reply({ 
                content: `🩹 | أنت **جريح** حالياً ولا يمكنك الصيد!\nعليك الراحة لمدة **${minutesLeft}** دقيقة حتى تشفى.`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        // تجهيز العدة
        const currentRod = rodsConfig.find(r => r.level === (userData.rodLevel || 1)) || rodsConfig[0];
        const currentBoat = boatsConfig.find(b => b.level === (userData.boatLevel || 1)) || boatsConfig[0];
        const locationId = userData.currentLocation || 'beach';
        const currentLocation = locationsConfig.find(l => l.id === locationId) || locationsConfig[0];

        // الكولداون
        let cooldown = currentRod.cooldown - (currentBoat.speed_bonus || 0);
        if (cooldown < 10000) cooldown = 10000; 

        const lastFish = userData.lastFish || 0;

        if (user.id !== OWNER_ID && (now - lastFish < cooldown)) {
            const remaining = lastFish + cooldown - now;
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
            return reply({ 
                content: `قمـت بالصيـد مؤخـرا انتـظـر **${minutes}:${seconds}** لتـذهب للصيـد مجددا`
            });
        }

        if (isSlash) await interactionOrMessage.deferReply();

        // 3. واجهة الانتظار
        const startEmbed = new EmbedBuilder()
            .setTitle(`🎣 رحلة صيد: ${currentLocation.name}`)
            .setColor(Colors.Blue)
            .setDescription(`**عدتك الحالية:**\n🎣 **السنارة:** ${currentRod.name}\n🚤 **القارب:** ${currentBoat.name}\n🌊 **المنطقة:** ${currentLocation.name}`)
            .setFooter({ text: "اضغط الزر أدناه لرمي السنارة..." });

        const startRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cast_rod').setLabel('رمي السنارة').setStyle(ButtonStyle.Primary).setEmoji('🎣')
        );

        const msg = await reply({ embeds: [startEmbed], components: [startRow] });

        const filter = i => i.user.id === user.id && i.customId === 'cast_rod';
        const collector = msg.createMessageComponentCollector({ filter, time: 30000, max: 1 });

        collector.on('collect', async i => {
            await i.deferUpdate();

            const waitingEmbed = new EmbedBuilder()
                .setTitle("🌊 السنارة في الماء...")
                .setDescription("انتظر... لا تسحب السنارة حتى تشعر بالاهتزاز!")
                .setColor(Colors.Grey)
                .setImage("https://i.postimg.cc/Wz0g0Zg0/fishing.png");

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pull_rod').setLabel('...').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );

            await i.editReply({ embeds: [waitingEmbed], components: [disabledRow] });

            const waitTime = Math.floor(Math.random() * 3000) + 2000;

            setTimeout(async () => {
                // 🎲 إعداد لعبة الألوان
                const targetColor = COLOR_GAME_OPTIONS[Math.floor(Math.random() * COLOR_GAME_OPTIONS.length)];
                
                let distractors = COLOR_GAME_OPTIONS.filter(c => c.id !== targetColor.id);
                distractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 3);
                
                let gameButtons = [targetColor, ...distractors];
                gameButtons = gameButtons.sort(() => 0.5 - Math.random());

                const gameRow = new ActionRowBuilder();
                gameButtons.forEach(btn => {
                    gameRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`fish_click_${btn.id}`)
                            .setEmoji(btn.emoji)
                            .setStyle(ButtonStyle.Secondary)
                    );
                });

                // لون عشوائي للايمبد
                const randomEmbedColor = Math.floor(Math.random() * 0xFFFFFF);

                const biteEmbed = new EmbedBuilder()
                    .setTitle("🎣 الـسنـارة تهـتز اسحـب الان !")
                    .setDescription(`**اسحـب السنـارة بسـرعة اضغـط على** ${targetColor.emoji}`)
                    .setColor(randomEmbedColor);

                await i.editReply({ embeds: [biteEmbed], components: [gameRow] });

                const pullFilter = j => j.user.id === user.id && j.customId.startsWith('fish_click_');
                // الوقت ثانيتين
                const pullCollector = msg.createMessageComponentCollector({ filter: pullFilter, time: 2000, max: 1 }); 

                pullCollector.on('collect', async j => {
                    await j.deferUpdate();
                    
                    const clickedColorId = j.customId.replace('fish_click_', '');

                    // ❌ إذا ضغط اللون الخطأ
                    if (clickedColorId !== targetColor.id) {
                        pullCollector.stop('wrong_color');
                        
                        const clickedButtonObj = COLOR_GAME_OPTIONS.find(c => c.id === clickedColorId);
                        const wrongEmoji = clickedButtonObj ? clickedButtonObj.emoji : '❓';

                        const failEmbed = new EmbedBuilder()
                            .setTitle("❌ أفلتت السنارة!")
                            .setDescription(`سحـبت السنـارة من المـكان الغـلط ضغـطت زر ${wrongEmoji}`)
                            .setColor(Colors.Red);
                        
                        userData.lastFish = Date.now();
                        client.setLevel.run(userData);
                        await j.editReply({ embeds: [failEmbed], components: [] });
                        return;
                    }

                    pullCollector.stop('success');

                    // ========================================================
                    // 🦑 منطق الوحوش (المحدث)
                    // ========================================================
                    const monsterChanceBase = Math.random();
                    const isOwner = user.id === OWNER_ID;
                    
                    // 🌟 تعديل النسبة: 50% للمالك، 10% للبقية
                    const monsterTriggered = isOwner ? (monsterChanceBase < 0.50) : (monsterChanceBase < 0.10);

                    // 🌟 تعديل الفلترة: الوحش يجب أن يكون من نفس المنطقة الحالية
                    const possibleMonsters = monstersConfig.filter(m => m.locations.includes(locationId));
                    
                    // يظهر الوحش فقط إذا تم تفعيله، ووجد وحش في هذه المنطقة
                    if (possibleMonsters.length > 0 && monsterTriggered) {
                        const monster = possibleMonsters[Math.floor(Math.random() * possibleMonsters.length)];
                        
                        let playerWeapon = pvpCore.getWeaponData(sql, j.member);
                        if (!playerWeapon || playerWeapon.currentLevel === 0) {
                            playerWeapon = { name: "سكين صيد صدئة", currentStats: { damage: 15 } };
                        }

                        let playerSkill = null;
                        try {
                            if (pvpCore.getUserActiveSkill) playerSkill = await pvpCore.getUserActiveSkill(sql, user.id, guild.id);
                        } catch (e) {}

                        let basePower = playerWeapon.currentStats.damage;
                        let skillBonus = 0;
                        let skillMessage = "";

                        if (playerSkill) {
                            skillBonus = playerSkill.damage || (playerSkill.level * 20) || 50; 
                            skillMessage = `\n🔥 **مهارة تلقائية:** استخدمت **${playerSkill.name}** (+${skillBonus} DMG)!`;
                        }

                        const totalPlayerPower = basePower + skillBonus;
                        const variance = (Math.random() * 0.4) + 0.8;
                        const monsterPower = Math.floor(Math.max(monster.base_power, totalPlayerPower * variance));

                        const playerRoll = totalPlayerPower + (Math.random() * 50);
                        const monsterRoll = monsterPower + (Math.random() * 50);

                        if (monsterRoll > playerRoll) {
                            // الخسارة
                            const expireTime = Date.now() + (15 * 60 * 1000);
                            sql.prepare(`INSERT INTO user_buffs (userID, guildID, buffType, expiresAt) VALUES (?, ?, 'pvp_wounded', ?)`).run(user.id, guild.id, expireTime);

                            const loseEmbed = new EmbedBuilder()
                                .setTitle(`🩸 ظهر ${monster.name} ${monster.emoji}!`)
                                .setDescription(`بينما كنت تسحب السنارة، هاجمك وحش بقوة **${monsterPower}**!\nقوتك: **${totalPlayerPower}**\n\n❌ **لقد هزمك الوحش!**\n🤕 **أصبحت جريحاً ولن تتمكن من الصيد لمدة 15 دقيقة.**`)
                                .setColor(Colors.DarkRed)
                                .setThumbnail(monster.image || "https://i.postimg.cc/0QNJzXv1/Anime-Anger-GIF-Anime-Anger-ANGRY-Descobrir-e-Compartilhar-GIFs.gif");

                            userData.lastFish = Date.now();
                            client.setLevel.run(userData);

                            return j.editReply({ embeds: [loseEmbed], components: [] });
                        } else {
                            // الفوز
                            var monsterReward = Math.floor(Math.random() * (monster.max_reward - monster.min_reward + 1)) + monster.min_reward;
                            // 🌟 إضافة XP عشوائي (50 - 300)
                            var monsterXP = Math.floor(Math.random() * (300 - 50 + 1)) + 50;
                            
                            // تحديث XP في الداتابيس
                            userData.xp = (userData.xp || 0) + monsterXP;

                            let winMsg = `⚔️ **قهرت ${monster.name}!**\nاستخدمت **${playerWeapon.name}** بقوة **${basePower}**${skillMessage}\n💰 غنيمة الوحش: **${monsterReward}** ${EMOJI_MORA} و **${monsterXP}** XP ✨`;
                            await j.followUp({ content: winMsg, flags: [MessageFlags.Ephemeral] });
                        }
                    }

                    // --- الصيد الطبيعي ---
                    const fishCount = Math.floor(Math.random() * currentRod.max_fish) + 1;
                    let caughtFish = [];
                    let totalValue = (typeof monsterReward !== 'undefined') ? monsterReward : 0;

                    for (let k = 0; k < fishCount; k++) {
                        const roll = Math.random() * 100 + (currentRod.luck_bonus || 0);
                        let rarity = 1;
                        if (roll > 95) rarity = 6;        
                        else if (roll > 85) rarity = 5;   
                        else if (roll > 70) rarity = 4;   
                        else if (roll > 50) rarity = 3;   
                        else if (roll > 30) rarity = 2;   
                        else rarity = 1;                  

                        let possibleFish = [];
                        while (possibleFish.length === 0 && rarity >= 1) {
                             possibleFish = fishItems.filter(f => f.rarity === rarity); 
                             if (possibleFish.length === 0) rarity--;
                        }
                        
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

                    userData.lastFish = Date.now();
                    userData.mora = (userData.mora || 0) + totalValue;
                    client.setLevel.run(userData);

                    const summary = {};
                    caughtFish.forEach(f => {
                        summary[f.name] = summary[f.name] ? { count: summary[f.name].count + 1, emoji: f.emoji, rarity: f.rarity } : { count: 1, emoji: f.emoji, rarity: f.rarity };
                    });

                    let description = "✶ قمـت بصيـد:\n";
                    for (const [name, info] of Object.entries(summary)) {
                        let rarityStar = "";
                        if (info.rarity >= 5) rarityStar = "🌟"; else if (info.rarity === 4) rarityStar = "✨";
                        description += `✶ ${info.emoji} ${name} ${rarityStar} **x${info.count}**\n`;
                    }

                    if (typeof monsterReward !== 'undefined') {
                        description += `\n⚔️ **غنيمة الوحش:** +${monsterReward} ${EMOJI_MORA}`;
                        if (typeof monsterXP !== 'undefined') description += ` | +${monsterXP} XP ✨`;
                    }

                    description += `\n✶ إجمـالي المكسـب: \`${totalValue.toLocaleString()}\` ${EMOJI_MORA}`;

                    const successEmbed = new EmbedBuilder()
                        .setTitle(`✥ رحـلـة صيـد فـي المحيـط !`) 
                        .setDescription(description)
                        .setColor(randomEmbedColor) // لون عشوائي
                        .setThumbnail('https://i.postimg.cc/Wz0g0Zg0/fishing.png')
                        .setFooter({ text: `السنارة: ${currentRod.name} (Lvl ${currentRod.level})` });

                    await j.editReply({ embeds: [successEmbed], components: [] });
                });

                pullCollector.on('end', async (collected, reason) => {
                    if (reason === 'time' || (reason !== 'success' && reason !== 'wrong_color' && collected.size === 0)) {
                        const failEmbed = new EmbedBuilder()
                            .setTitle("💨 هربت السمكة!")
                            .setDescription("تأخرت في الاستجابة! السمكة سريعة جدًا.")
                            .setColor(Colors.Red);
                        
                        userData.lastFish = Date.now();
                        client.setLevel.run(userData);

                        await i.editReply({ embeds: [failEmbed], components: [] }).catch(() => {});
                    }
                });

            }, waitTime);
        });
    }
};
