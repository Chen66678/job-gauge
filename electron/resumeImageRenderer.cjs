const { BrowserWindow } = require("electron");

function waitForResumeImagePaint(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        width: Math.ceil(document.documentElement.scrollWidth),
        height: Math.ceil(document.documentElement.scrollHeight)
      };
    })()
  `);
}

function waitForOffscreenPaint(window) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.webContents.removeListener("paint", onPaint);
      reject(new Error("等待简历离屏窗口绘制超时。"));
    }, 5000);
    const onPaint = () => {
      clearTimeout(timeout);
      resolve();
    };
    window.webContents.once("paint", onPaint);
    window.webContents.invalidate();
  });
}

function createResumeImageRenderer(buildResumeImageHtml) {
  return async function renderResumeImage(input) {
    const renderWindow = new BrowserWindow({
      show: false,
      width: 960,
      height: 1200,
      useContentSize: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    try {
      const html = buildResumeImageHtml(input);
      await renderWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      const dimensions = await waitForResumeImagePaint(renderWindow);
      renderWindow.setContentSize(dimensions.width, dimensions.height);
      await waitForResumeImagePaint(renderWindow);
      await waitForOffscreenPaint(renderWindow);
      const image = await renderWindow.webContents.capturePage({
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height
      });
      return image.toDataURL();
    } finally {
      if (!renderWindow.isDestroyed()) renderWindow.destroy();
    }
  };
}

module.exports = { createResumeImageRenderer };
