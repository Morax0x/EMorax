const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const path = require('path');

// تحديد المسار الصحيح لملف الحيوانات
const rootDir = process.cwd();
const farmAnimals = require(path.join(rootDir, 'json', 'farm-animals.json'));

const EMOJI_MORA = '<:mora:1435647151349698621>';

async function handleFarmInteractions(i, client, sql) {
    const userId = i.user.id;
    const guildId = i.guild.id;

    // 1. جمع الأرباح
    if (i.customId === 'farm_collect') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        
        let userData = client.getLevel.get(userId, guildId);
        if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };

        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        
        // التحقق من مرور 24 ساعة
        if ((now - (userData.lastFarmYield || 0)) < ONE_DAY) {
            const timeLeft = (userData.lastFarmYield || 0) + ONE_DAY - now;
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return i.editReply(`⏳ لا يمكنك جمع الأرباح الآن. انتظر **${hours}س ${minutes}د**.`);
        }

        // حساب الأرباح
        const userAnimals = sql.prepare("SELECT animalID, COUNT(*) as count FROM user_farm WHERE userID = ? AND guildID = ? GROUP BY animalID").all(userId, guildId);
        let totalIncome = 0;

        for (const row of userAnimals) {
            const animalInfo = farmAnimals.find(a => a.id === row.animalID);
            if (animalInfo) totalIncome += (animalInfo.income_per_day * row.count);
        }

        if (totalIncome > 0) {
            userData.mora += totalIncome;
            userData.lastFarmYield = now;
            client.setLevel.run(userData);
            return i.editReply(`✅ تم جمع الأرباح بنجاح!\n💰 حصلت على **${totalIncome.toLocaleString()}** ${EMOJI_MORA}`);
        } else {
            return i.editReply(`❌ مزرعتك لا تنتج أرباحاً بعد (أو فارغة).`);
        }
    }

    // 2. فتح قائمة الشراء
    if (i.customId === 'farm_buy_menu') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        
        // تجهيز خيارات القائمة
        const options = farmAnimals.map(a => ({
            label: `${a.name} (${a.price.toLocaleString()} مورا)`,
            description: `الدخل: ${a.income_per_day}/يوم | العمر: ${a.lifespan_days} يوم`,
            value: `buy_animal_${a.id}`,
            emoji: a.emoji
        }));

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('farm_shop_select')
                .setPlaceholder('اختر حيواناً لشرائه...')
                .addOptions(options)
        );

        return i.editReply({ content: "🛒 **متجر المزرعة:**", components: [row] });
    }

    // 3. تنفيذ الشراء من القائمة
    if (i.isStringSelectMenu() && i.customId === 'farm_shop_select') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        
        const animalId = i.values[0].replace('buy_animal_', '');
        const animal = farmAnimals.find(a => a.id === animalId);
        
        if (!animal) return i.editReply("❌ حيوان غير موجود.");

        let userData = client.getLevel.get(userId, guildId);
        if (!userData) userData = { ...client.defaultData, user: userId, guild: guildId };

        if (userData.mora < animal.price) {
            return i.editReply(`❌ رصيدك غير كافي! تحتاج **${animal.price.toLocaleString()}** ${EMOJI_MORA}`);
        }

        // خصم المبلغ وإضافة الحيوان
        userData.mora -= animal.price;
        client.setLevel.run(userData);

        sql.prepare("INSERT INTO user_farm (userID, guildID, animalID, purchaseTimestamp) VALUES (?, ?, ?, ?)").run(userId, guildId, animal.id, Date.now());

        return i.editReply(`✅ تم شراء **${animal.name}** ${animal.emoji} بنجاح!`);
    }
}

module.exports = { handleFarmInteractions };
