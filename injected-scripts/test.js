// 测试脚本 - 验证注入是否成功
console.log('========================================');
console.log('🎯 TEST SCRIPT INJECTED SUCCESSFULLY!');
console.log('========================================');
console.log('当前页面:', window.location.href);
console.log('User Agent:', navigator.userAgent);
console.log('========================================');

// 在页面上显示一个明显的提示
alert('✅ 脚本注入成功！这是测试脚本。');

// 修改页面背景色为淡绿色，确认脚本生效
document.body.style.backgroundColor = '#e8f5e9';
