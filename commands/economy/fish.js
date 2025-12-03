const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const path = require('path');

// 1. تحديد المسار الجذري
const rootDir = process.cwd();

// 2. استدعاء ملف الإعدادات
const fishingConfig = require(path.join(rootDir, 'json', 'fishing-config.json'));

// 3. استدعاء دوال الـ PvP بطريقة آمنة
let pvpCore;
try {
    pvpCore = require(path.join(rootDir, 'handlers', 'pvp-core.js'));
} catch (e) {
    console.error("[Fish Cmd] Error loading pvp-core.js:", e.message);
    pvpCore = {}; 
}

// 4. التأكد من وجود الدوال (Self-Healing)
if (typeof pvpCore.getWeaponData !== 'function') {
    pvpCore.getWeaponData = () => ({ name: "سكين صيد صدئة", currentDamage: 15, currentLevel: 1 });
}
if (typeof pvpCore.getUserActiveSkill !== 'function') {
    pvpCore.getUserActiveSkill = () => null;
}
if (typeof pvpCore.startPveBattle !== 'function') {
    pvpCore.startPveBattle = async (i) => {
        await i.followUp({ content: "⚠️ حدث خطأ: نظام القتال غير جاهز حالياً.", flags: [MessageFlags.Ephemeral] });
    };
}

// استخراج البيانات
const fishItems = fishingConfig.fishItems;
const rodsConfig = fishingConfig.rods;
const boatsConfig = fishingConfig.boats;
const baitsConfig = fishingConfig.baits; 
const locationsConfig = fishingConfig.locations;
const monstersConfig = fishingConfig.monsters || [];

// 🔒 آيدي المالك
const OWNER_ID = "1145327691772481577";
const EMOJI_MORA = '<:mora:1435647151349698621>';

// 🎨 قائمة الألوان
const COLOR_GAME_OPTIONS = [
    { id: 'red', emoji: '🔴' }, { id: 'blue', emoji: '🔵' }, { id: 'green', emoji: '🟢' },
    { id: 'yellow', emoji: '🟡' }, { id: 'purple', emoji: '🟣' }, { id: 'white', emoji: '⚪' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('صيد')
        .setDescription('ابـدأ رحـلـة صيد'),

    name: 'fish',
    aliases: ['صيد', 'ص', 'fishing'],
    category: "Economy",
    description: "صيد الأسماك مع مواجهات وحوش.",

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

        // البحث عن الطعم
        const userPortfolio = sql.prepare("SELECT itemID, quantity FROM user_portfolio WHERE userID = ? AND guildID = ?").all(user.id, guild.id);
        const availableBaits = userPortfolio
            .map(item => {
                const config = baitsConfig.find(b => b.id === item.itemID);
                return config ? { ...config, qty: item.quantity } : null;
            })
            .filter(b => b !== null)
            .sort((a, b) => b.luck - a.luck); 

        const currentBait = availableBaits.length > 0 ? availableBaits[0] : null;
        const baitText = currentBait ? `\n🪱 **الطعم:** ${currentBait.name} (x${currentBait.qty})` : "";

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

        // واجهة الانتظار
        const startEmbed = new EmbedBuilder()
            .setTitle(`🎣 رحلة صيد: ${currentLocation.name}`)
            .setColor(Colors.Blue)
            .setDescription(`**عدتك الحالية:**\n🎣 **السنارة:** ${currentRod.name}\n🚤 **القارب:** ${currentBoat.name}\n🌊 **المنطقة:** ${currentLocation.name}${baitText}`)
            .setFooter({ text: "اضغط الزر أدناه لرمي السنارة..." });

        const startRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cast_rod').setLabel('رمي السنارة').setStyle(ButtonStyle.Primary).setEmoji('🎣')
        );

        const msg = await reply({ embeds: [startEmbed], components: [startRow] });

        const filter = i => i.user.id === user.id && i.customId === 'cast_rod';
        const collector = msg.createMessageComponentCollector({ filter, time: 30000, max: 1 });

        collector.on('collect', async i => {
            await i.deferUpdate();

            // خصم الطعم
            if (currentBait) {
                if (currentBait.qty > 1) {
                    sql.prepare("UPDATE user_portfolio SET quantity = quantity - 1 WHERE userID = ? AND guildID = ? AND itemID = ?").run(user.id, guild.id, currentBait.id);
                } else {
                    sql.prepare("DELETE FROM user_portfolio WHERE userID = ? AND guildID = ? AND itemID = ?").run(user.id, guild.id, currentBait.id);
                }
            }

            const waitingEmbed = new EmbedBuilder()
                .setTitle("🌊 السنارة في الماء...")
                .setDescription("انتـظـر حتـى تهتـز السنـارة واضغط الزر المنـاسـب ...")
                .setColor(Colors.Grey)
                .setImage("https://i.postimg.cc/Wz0g0Zg0/fishing.png");

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pull_rod').setLabel('...').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );

            await i.editReply({ embeds: [waitingEmbed], components: [disabledRow] });

            const waitTime = Math.floor(Math.random() * 3000) + 2000;

            setTimeout(async () => {
                const targetColor = COLOR_GAME_OPTIONS[Math.floor(Math.random() * COLOR_GAME_OPTIONS.length)];
                
                let distractors = COLOR_GAME_OPTIONS.filter(c => c.id !== targetColor.id);
                distractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 3);
                let gameButtons = [targetColor, ...distractors].sort(() => 0.5 - Math.random());

                const gameRow = new ActionRowBuilder();
                gameButtons.forEach(btn => {
                    gameRow.addComponents(
                        new ButtonBuilder().setCustomId(`fish_click_${btn.id}`).setEmoji(btn.emoji).setStyle(ButtonStyle.Secondary)
                    );
                });

                const randomEmbedColor = Math.floor(Math.random() * 0xFFFFFF);
                const biteEmbed = new EmbedBuilder()
                    .setTitle("🎣 الـسنـارة تهـتز اسحـب الان !")
                    .setDescription(`**اسحـب السنـارة بسـرعة اضغـط على** ${targetColor.emoji}`)
                    .setColor(randomEmbedColor);

                await i.editReply({ embeds: [biteEmbed], components: [gameRow] });

                const pullFilter = j => j.user.id === user.id && j.customId.startsWith('fish_click_');
                const pullCollector = msg.createMessageComponentCollector({ filter: pullFilter, time: 3000, max: 1 }); 

                pullCollector.on('collect', async j => {
                    await j.deferUpdate();
                    
                    const clickedColorId = j.customId.replace('fish_click_', '');

                    if (clickedColorId !== targetColor.id) {
                        pullCollector.stop('wrong_color');
                        const clickedButtonObj = COLOR_GAME_OPTIONS.find(c => c.id === clickedColorId);
                        const wrongEmoji = clickedButtonObj ? clickedButtonObj.emoji : '❓';
                        const failEmbed = new EmbedBuilder().setTitle("❌ أفلتت السنارة!").setDescription(`سحـبت السنـارة من المـكان الغـلط ضغـطت زر ${wrongEmoji}`).setColor(Colors.Red);
                        userData.lastFish = Date.now();
                        client.setLevel.run(userData);
                        await j.editReply({ embeds: [failEmbed], components: [] });
                        return;
                    }

                    pullCollector.stop('success');

                    // ========================================================
                    // 🦑 Monster Logic (PvE)
                    // ========================================================
                    const monsterChanceBase = Math.random();
                    const isOwner = user.id === OWNER_ID;
                    const monsterTriggered = isOwner ? (monsterChanceBase < 0.50) : (monsterChanceBase < 0.10);

                    let possibleMonsters = monstersConfig.filter(m => m.locations.includes(locationId));
                    if (isOwner && possibleMonsters.length === 0) possibleMonsters = monstersConfig; 
                    
                    if (possibleMonsters.length > 0 && monsterTriggered) {
                        const monster = possibleMonsters[Math.floor(Math.random() * possibleMonsters.length)];
                        
                        let playerWeapon = pvpCore.getWeaponData(sql, j.member);
                        if (!playerWeapon || playerWeapon.currentLevel === 0) {
                            playerWeapon = { name: "سكين صيد صدئة", currentDamage: 15, currentLevel: 1 };
                        }

                        if (pvpCore.startPveBattle) {
                            await pvpCore.startPveBattle(j, client, sql, j.member, monster, playerWeapon);
                            return; 
                        } else {
                            console.error("pvpCore.startPveBattle is missing!");
                        }
                    }

                    // --- Normal Fishing ---
                    const fishCount = Math.floor(Math.random() * currentRod.max_fish) + 1;
                    let caughtFish = [];
                    let totalValue = 0;
                    
                    const baitLuckBonus = currentBait ? (currentBait.luck || 0) : 0;

                    for (let k = 0; k < fishCount; k++) {
                        const roll = Math.random() * 100 + (currentRod.luck_bonus || 0) + baitLuckBonus;
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
                            
                            // ✅ ( تم إعادة تفعيل الحفظ في الحقيبة ) ✅
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
                    description += `\n✶ قيـمـة الصيد: \`${totalValue.toLocaleString()}\` ${EMOJI_MORA}`;

                    const resultEmbed = new EmbedBuilder()
                        .setTitle(`✥ رحـلـة صيـد فـي المحيـط !`) 
                        .setDescription(description)
                        .setColor(Colors.Green)
                        .setThumbnail('https://i.postimg.cc/Wz0g0Zg0/fishing.png')
                        .setFooter({ text: `السنارة: ${currentRod.name} (Lvl ${currentRod.level})` });

                    await j.editReply({ embeds: [resultEmbed], components: [] });
                });

                pullCollector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        const failEmbed = new EmbedBuilder().setTitle("💨 هربت السمـكـة!")
                            .setDescription("تأخرت في السحب! حاول مرة أخرى لاحقاً.")
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
