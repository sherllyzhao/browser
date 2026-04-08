const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
  const localesPath = path.join(context.appOutDir, 'locales');

  if (!fs.existsSync(localesPath)) {
    console.log('⚠️  locales 目录不存在，跳过清理');
    return;
  }

  const keepLocales = ['zh-CN.pak', 'en-US.pak'];
  const files = fs.readdirSync(localesPath);
  let deletedCount = 0;
  let deletedSize = 0;

  files.forEach(file => {
    if (!keepLocales.includes(file)) {
      const filePath = path.join(localesPath, file);
      const stats = fs.statSync(filePath);
      deletedSize += stats.size;
      fs.unlinkSync(filePath);
      deletedCount++;
    }
  });

  console.log(`✅ 已删除 ${deletedCount} 个语言包，节省 ${(deletedSize / 1024 / 1024).toFixed(2)} MB`);
};
