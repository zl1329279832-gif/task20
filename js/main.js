/* ===== 应用入口 ===== */
document.addEventListener('DOMContentLoaded', async () => {
    const app = new EnergyApp.App();
    window._energyApp = app;
    try {
        await app.init();
        console.log('[能耗分析系统] 初始化完成');
    } catch (err) {
        console.error('[能耗分析系统] 初始化失败:', err);
        document.getElementById('toast-container').innerHTML =
            `<div class="toast error">系统初始化失败: ${err.message}</div>`;
    }
});
