const { EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, PermissionsBitField, Colors } = require("discord.js");

// (متغير لتخزين رول الروح الهائمة مؤقتاً)
let GHOST_ROLE_ID = null; 

// (دالة لجلب إعدادات الرتب من قاعدة البيانات إلى الكاش)
async function loadRoleSettings(sql, antiRolesCache) {
    antiRolesCache.clear();
    // تأكد من وجود الجدول قبل الاستعلام (لتجنب الأخطاء في أول تشغيل)
    try {
        const rows = sql.prepare("SELECT role_id, anti_roles, is_removable FROM role_settings").all();
        for (const row of rows) {
            const antiRolesList = row.anti_roles ? row.anti_roles.split(',').map(id => id.trim()).filter(id => id.length > 0) : [];
            antiRolesCache.set(row.role_id, {
                anti_roles: antiRolesList,
                is_removable: Boolean(row.is_removable)
            });
        }
        console.log(`[Reaction Roles] تم تحميل ${antiRolesCache.size} إعداد رول في الذاكرة.`);
    } catch (e) {
        console.log(`[Reaction Roles] الجدول غير موجود أو فارغ، تم تخطي التحميل.`);
    }
}

// (دالة لتحديث رول الروح الهائمة)
function setGhostRole(roleId) {
    GHOST_ROLE_ID = roleId;
}

// (المنطق الرئيسي لمعالجة التفاعل)
async function handleReactionRole(interaction, client, sql, antiRolesCache) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const selectedValues = interaction.values;
        const member = interaction.member;
        const memberRoleIds = new Set(member.roles.cache.keys());

        // --- ( جلب القفل ) ---
        const menuMaster = sql.prepare("SELECT is_locked FROM role_menus_master WHERE message_id = ?")
                              .get(interaction.message.id);

        if (!menuMaster) {
            return interaction.editReply({ content: 'حدث خطأ: هذه القائمة غير مسجلة في قاعدة البيانات.' });
        }
        
        const isLocked = menuMaster.is_locked === 1;

        // --- ( جلب بيانات الرولات - تم التصحيح ) ---
        const allMenuRoleData = sql.prepare(`
            SELECT T1.role_id, T2.is_removable, T1.value
            FROM role_menu_items T1
            LEFT JOIN role_settings T2 ON T1.role_id = T2.role_id
            WHERE T1.message_id = ?
        `).all(interaction.message.id); 
        // --------------------------------------------------
        
        let conflictDetected = false;
        
        // 1. تحقق من القفل الإلزامي (القوائم المقفولة)
        if (isLocked) {
            const currentMenuRoles = allMenuRoleData.filter(roleData => memberRoleIds.has(roleData.role_id));

            if (currentMenuRoles.length > 0) {
                // محاولة الإزالة أو التغيير
                if (selectedValues.length === 0 || currentMenuRoles.some(roleData => !selectedValues.includes(roleData.value)) || selectedValues.length > 1) { 
                    const refusalMessage = `✥ اجـراء مرفـوض <:0dalami:1395674712473862185>\n- تـم تحديـد عرقـك بالفعـل لا يسمح بتغييـره `;
                    return interaction.editReply({ content: refusalMessage });
                }
            } else if (selectedValues.length > 1) {
                // محاولة تحديد أكثر من رول في أول تفاعل
                const refusalMessage = `✥ اجـراء مرفـوض <:0dalami:1395674712473862185>\n- يسمح لك بتحديد عرق واحد لا غير `;
                return interaction.editReply({ content: refusalMessage });
            }
        }
        
        // 2. فحص التعارض الذاتي والقواعد العامة
        const rolesToKeep = new Set();
        const rolesToAdd = [];
        let rolesToStrip = []; 
        
        if (!isLocked) { // فقط للقوائم المفتوحة
            for (const selectedValue of selectedValues) {
                const menuData = allMenuRoleData.find(d => d.value === selectedValue);
                if (!menuData) continue;
                
                const targetRoleId = menuData.role_id;
                const roleSettings = antiRolesCache.get(targetRoleId) || {};
                const antiRoleIds = roleSettings.anti_roles || [];
                
                // التعارض مع رول آخر تم اختياره في نفس التفاعل
                const selfConflict = antiRoleIds.some(id => selectedValues.includes(allMenuRoleData.find(d => d.role_id === id)?.value));

                if (selfConflict) {
                    conflictDetected = true;
                    break;
                }
            }
        }

        if (conflictDetected) { 
            if (GHOST_ROLE_ID && guild.roles.cache.has(GHOST_ROLE_ID)) {
                if (!memberRoleIds.has(GHOST_ROLE_ID)) {
                    await member.roles.add(GHOST_ROLE_ID, 'تضارب في اختيار الرتب المضادة في نفس التفاعل.');
                }
                const refusalMessage = `✥ حـددت رتـب متضـاربـة لذا تـم رفـض اجراء اعطائك الرتب وتم منحك رتـبة روح هائـمـة ! حـاول تحديد رتبك مجددًا 👻`;
                return interaction.editReply({ content: refusalMessage });
            } else {
                const refusalMessage = `✥ اجـراء مرفـوض<:0dalami:1395674712473862185>\n- حدث تعارض بين الرتب المختارة في نفس التفاعل.`;
                return interaction.editReply({ content: refusalMessage });
            }
        }

        // 2.2. معالجة الإضافة والاستبدال/الإزالة
        for (const selectedValue of selectedValues) {
            const menuData = allMenuRoleData.find(d => d.value === selectedValue);
            if (!menuData) continue;

            const targetRoleId = menuData.role_id;
            const targetRole = guild.roles.cache.get(targetRoleId);
            if (!targetRole) continue;

            rolesToKeep.add(targetRoleId);

            if (!memberRoleIds.has(targetRoleId)) {
                rolesToAdd.push(targetRole);
            }

            const roleSettings = antiRolesCache.get(targetRoleId) || {};
            const antiRoleIds = roleSettings.anti_roles || [];

            for (const antiRoleId of antiRoleIds) {
                const antiRole = guild.roles.cache.get(antiRoleId);
                if (antiRole && memberRoleIds.has(antiRole.id) && !rolesToKeep.has(antiRole.id)) {
                    rolesToStrip.push(antiRole);
                }
            }
        }

        if (!isLocked) {
            for (const roleData of allMenuRoleData) {
                const roleId = roleData.role_id;
                const isRemovable = roleData.is_removable !== 0;

                if (isRemovable && memberRoleIds.has(roleId) && !rolesToKeep.has(roleId)) {
                    const roleToRemove = guild.roles.cache.get(roleId);
                    if(roleToRemove) {
                        rolesToStrip.push(roleToRemove);
                    }
                }
            }
        }
        
        const uniqueRolesToStrip = [...new Set(rolesToStrip)].filter(r => r && r.id !== GHOST_ROLE_ID); 
        const uniqueRolesToAdd = [...new Set(rolesToAdd)];

        try {
            if (uniqueRolesToStrip.length > 0) {
                await member.roles.remove(uniqueRolesToStrip, 'نظام الأدوار المضادة / إزالة الأدوار الزائدة.');
            }
            if (uniqueRolesToAdd.length > 0) {
                await member.roles.add(uniqueRolesToAdd);
            }
        } catch (e) {
            console.error("RR Handler Error (Adding/Removing Roles):", e);
            return interaction.editReply({ content: "حدث خطأ أثناء تعديل رتبك. قد تكون رتبتي أقل من الرتب المطلوبة." });
        }

        // بناء رسالة الملخص
        let responseMsg = '';
        const animatedEmoji = '<a:6HypedDance:1401907058047189127>';
        const idleEmoji = '<:1Hmmmm:1414570720704467035>';

        if (uniqueRolesToAdd.length > 0 || uniqueRolesToStrip.length > 0) {
            responseMsg += `> تـم تحديـث الـرتـب ${animatedEmoji}\n\n`;

            if (uniqueRolesToAdd.length > 0) {
                const addedMentions = uniqueRolesToAdd.map(r => `${r}`).join(' ');
                responseMsg += `- الرتب المضافة:\n${addedMentions}\n`;
            }

            if (uniqueRolesToStrip.length > 0) {
                const strippedMentions = uniqueRolesToStrip.map(r => `${r}`).join(' ');
                responseMsg += `- الـرتـب الـمزالــة:\n${strippedMentions}\n`;
            }
        } else {
            responseMsg = `❖ تـم التـحديـث لـم يتـم ازالـة او اضـافـة اي رتـبـة ${idleEmoji}`;
        }

        return interaction.editReply({ content: responseMsg });

    } catch (error) {
        console.error("[Reaction Role Handler] Fatal Error:", error);
        if (!interaction.replied && !interaction.deferred) {
             return interaction.reply({ content: "حدث خطأ داخلي أثناء معالجة الرتب.", ephemeral: true });
        } else {
             return interaction.editReply({ content: "حدث خطأ داخلي أثناء معالجة الرتب." });
        }
    }
}

module.exports = {
    handleReactionRole,
    loadRoleSettings,
    setGhostRole
};
