let introFilled = false; // 标记 intro 是否已填写
let fillFormRunning = false; // 标记 fillFormData 是否正在执行
let publishRunning = false; // 标记发布是否正在执行，防止重复点击

// 防重复标志：确保数据只处理一次
let isProcessing = false;
let hasProcessed = false;

/**
 * 百家号创作者平台发布脚本
 * 用于处理发布流程和数据传输
 *
 * 依赖: common.js (会在此脚本之前注入)
 */

(function() {
  'use strict';

  // ===========================
  // 防止脚本重复注入
  // ===========================
  if (window.__BJH_SCRIPT_LOADED__) {
    console.log('[百家号发布] ⚠️ 脚本已经加载过，跳过重复注入');
    return;
  }
  window.__BJH_SCRIPT_LOADED__ = true;

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号发布脚本已注入');
  console.log('📍 当前 URL:', window.location.href);
  console.log('🕐 注入时间:', new Date().toLocaleString());
  console.log('═══════════════════════════════════════');

  // 检查 common.js 是否已加载
  if (typeof waitForElement === 'undefined' || typeof retryOperation === 'undefined') {
    console.error('[百家号发布] ❌ common.js 未加载！脚本可能无法正常工作');
  } else {
    console.log('[百家号发布] ✅ common.js 已加载，工具函数可用');
  }

  // ===========================
  // 1. 从 URL 获取发布数据
  // ===========================

  const urlParams = new URLSearchParams(window.location.search);
  const companyId = urlParams.get('company_id');
  const transferId = urlParams.get('transfer_id');

  console.log('[百家号发布] URL 参数:', {
    companyId,
    transferId
  });

  // 存储发布数据到全局
  window.__AUTH_DATA__ = {
    companyId,
    transferId,
    timestamp: Date.now()
  };

  // ===========================
  // 2. 暴露全局方法供手动调用
  // ===========================

  window.__BJH_AUTH__ = {
    // 发送发布成功消息
    notifySuccess: () => {
      sendMessageToParent('发布成功');
    },

    // 发送自定义消息
    sendMessage: (message) => {
      sendMessageToParent(message);
    },

    // 获取发布数据
    getAuthData: () => window.__AUTH_DATA__,
  };

  // ===========================
  // 4. 显示调试信息横幅
  // ===========================

  // 先删除旧的横幅（如果存在）
  const oldBanner = document.getElementById('bjh-auth-banner');
  if (oldBanner) {
    console.log('[百家号发布] 删除旧的横幅');
    oldBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'bjh-auth-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #ee0a24 0%, #ff6034 100%);
    color: white;
    padding: 12px 20px;
    text-align: center;
    font-family: Arial, sans-serif;
    z-index: 999999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    font-size: 14px;
  `;
  banner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; max-width: 1200px; margin: 0 auto;">
      <div id="auth-info-display">
        🎵 百家号发布脚本已运行 | Company ID: ${companyId || '未知'}
      </div>
      <div>
        <button onclick="window.__BJH_AUTH__.notifySuccess()" style="
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.5);
          color: white;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-left: 10px;
          font-size: 13px;
        ">测试发送消息</button>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" style="
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.5);
          color: white;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-left: 10px;
          font-size: 13px;
        ">关闭</button>
      </div>
    </div>
  `;

  // 添加横幅到页面
  function addBannerToPage() {
    if (document.body) {
      console.log('[百家号发布] ✅ document.body 存在，立即添加横幅');
      document.body.appendChild(banner);
    } else {
      console.log('[百家号发布] ⚠️ document.body 不存在，等待 DOM 加载');
      document.addEventListener('DOMContentLoaded', () => {
        console.log('[百家号发布] ✅ DOMContentLoaded 触发，添加横幅');
        if (document.body) {
          document.body.appendChild(banner);
        }
      });
      // 如果 DOMContentLoaded 已经触发过，用定时器重试
      setTimeout(() => {
        if (document.body && !document.getElementById('bjh-auth-banner')) {
          console.log('[百家号发布] ✅ 使用定时器添加横幅');
          document.body.appendChild(banner);
        }
      }, 100);
    }
  }

  addBannerToPage();

  // ===========================
  // 5. 接收来自父窗口的消息（必须在发送 页面加载完成 之前注册！）
  // ===========================
  console.log('[百家号发布] 注册消息监听器...');

  if (!window.browserAPI) {
    console.error('[百家号发布] ❌ browserAPI 不可用！');
  } else {
    console.log('[百家号发布] ✅ browserAPI 可用');

    if (!window.browserAPI.onMessageFromHome) {
      console.error('[百家号发布] ❌ browserAPI.onMessageFromHome 不可用！');
    } else {
      console.log('[百家号发布] ✅ browserAPI.onMessageFromHome 可用，正在注册...');

      window.browserAPI.onMessageFromHome(async (message) => {
        console.log('═══════════════════════════════════════');
        console.log('[百家号发布] 🎉 收到来自父窗口的消息!');
        console.log('[百家号发布] 消息类型:', typeof message);
        console.log('[百家号发布] 消息内容:', message);
        console.log('[百家号发布] 消息.type:', message?.type);
        console.log('[百家号发布] 消息.data:', message?.data);
        console.log('═══════════════════════════════════════');

        // 接收完整的发布数据（直接传递，不使用 IndexedDB）
        if (message.type === 'auth-data') {
          console.log('[百家号发布] ✅ 收到发布数据:', message.data);

          // 防重复检查
          if (isProcessing) {
            console.warn('[百家号发布] ⚠️ 正在处理中，忽略重复消息');
            return;
          }
          if (hasProcessed) {
            console.warn('[百家号发布] ⚠️ 已经处理过，忽略重复消息');
            return;
          }

          // 标记为正在处理
          isProcessing = true;

          // 更新全局变量
          if (message.data) {
            window.__AUTH_DATA__ = {
              ...window.__AUTH_DATA__,
              message: JSON.parse(message.data),
              receivedAt: Date.now()
            };
            console.log('[百家号发布] ✅ 发布数据已更新:', window.__AUTH_DATA__);
            const messageData = JSON.parse(message.data);
            console.log("🚀 ~  ~ messageData: ", messageData);

            // 更新横幅显示
            const infoDisplay = document.getElementById('auth-info-display');
            console.log('[百家号发布] 查找横幅元素 #auth-info-display:', infoDisplay);

            if (infoDisplay) {
              console.log('[百家号发布] 更新前的内容:', infoDisplay.textContent);

              const newContent = `🎵 百家号发布脚本已运行 | Company ID: ${messageData.company_id || '未知'} | Platform: ${messageData.platform_value || '未知'}`;
              console.log('[百家号发布] 准备更新为:', newContent);

              // 使用 textContent 更新
              infoDisplay.textContent = newContent;

              // 强制刷新样式
              infoDisplay.style.display = 'none';
              infoDisplay.offsetHeight; // 触发重排
              infoDisplay.style.display = 'block';

              console.log('[百家号发布] 更新后的内容:', infoDisplay.textContent);
              console.log('[百家号发布] ✅ 横幅已更新');
            } else {
              console.error('[百家号发布] ❌ 未找到横幅信息元素 #auth-info-display');
              console.log('[百家号发布] 尝试查找 banner...');
              const banner = document.getElementById('bjh-auth-banner');
              console.log('[百家号发布] banner 元素:', banner);
              if (banner) {
                console.log('[百家号发布] banner.innerHTML:', banner.innerHTML.substring(0, 200));
              }
            }

            try{
              await retryOperation(async () => await fillFormData(messageData), 3, 2000);
            }catch (e){
              console.log('[百家号发布] ❌ 填写表单数据失败:', e);
            }

            console.log('[百家号发布] 📤 准备发送数据到接口...');
            console.log('[百家号发布] ✅ 发布流程已启动，等待 publishApi 完成...');
            // 注意：不在这里关闭窗口，因为 publishApi 内部有异步的统计接口调用
            // 窗口会在 publishApi 完成后自动关闭
          }

          // 重置处理标志（无论成功或失败）
          isProcessing = false;
          console.log('[百家号发布] 处理完成，isProcessing=false, hasProcessed=', hasProcessed);
        }
      });

      console.log('[百家号发布] ✅ 消息监听器注册成功');
    }
  }

  // ===========================
  // 6. 页面加载完成向父窗口发送消息（必须在监听器注册之后！）
  // ===========================

  // 页面加载完成后向父窗口发送消息
  console.log('[百家号发布] 页面加载完成，发送 页面加载完成 消息');
  sendMessageToParent('页面加载完成');

  console.log('═══════════════════════════════════════');
  console.log('✅ 百家号发布脚本初始化完成');
  console.log('📝 全局方法: window.__BJH_AUTH__');
  console.log('  - notifySuccess()  : 发送发布成功消息');
  console.log('  - sendMessage(msg) : 发送自定义消息');
  console.log('  - getAuthData()    : 获取发布数据');
  console.log('═══════════════════════════════════════');

})();

// ===========================
// 7. 发布视频到百家号
// ===========================
async function publishApi(dataObj) {
  console.log("🚀 ~ publishApi ~ dataObj: ", dataObj);

  // 防止重复执行
  if (publishRunning) {
    console.log('Publish is already running, skipping duplicate call');
    return;
  }

  try {
    // 标记发布正在进行
    publishRunning = true;

    // 等待发布按钮可用
    const publishBtn = await retryOperation(async () => {
      const btn = document.querySelector(".cheetah-modal-confirm-btns .cheetah-btn-primary");
      if (!btn) {
        throw new Error('Publish button not found');
      }
      return btn;
    }, 10, 2000);

    // 等待按钮事件绑定完成
    await delay(800);

    // 点击发布按钮
    console.log('[百家号发布] 🖱️ 准备点击发布按钮...');
    const clickSuccess = await clickWithRetry(publishBtn, 3, 500);

    if (!clickSuccess) {
      console.error('[百家号发布] ❌ 所有点击尝试均失败');
      publishRunning = false;
      throw new Error('发布按钮点击失败');
    }

    console.log('[百家号发布] ✅ 发布按钮已点击');

    // 等待页面稳定后发送统计接口
    await delay(2000);

    // 发送统计接口
    const publishId = dataObj.video.dyPlatform.id;
    await sendStatistics(publishId, '百家号发布');

    // 标记已完成
    hasProcessed = true;
    publishRunning = false;

    // 等待页面稳定后发送统计接口
    await delay(2000);

    // 发送成功消息并关闭窗口
    await closeWindowWithMessage('发布成功，刷新数据', 1000);

  } catch (error) {
    console.log("🚀 ~ publishApi ~ error: ", error);
    publishRunning = false;
  }
}

function getOptions(ele, value) {
  if (ele) {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window });
    ele.dispatchEvent(event);
    setTimeout(() => {
      // 获取所有下拉菜单
      const dropdowns = document.querySelectorAll(".cheetah-select-dropdown");
      if (dropdowns && dropdowns.length) {
        // 取最后一个（最新弹出的）
        const currentDropdown = dropdowns[dropdowns.length - 1];
        // 找到你想选的那个选项，比如 value=2
        const targetOption = Array.from(currentDropdown.querySelectorAll(".cheetah-select-item-option-content")).find(
            el => {
              const text = el.innerText.replace(/[\u4e00-\u9fa5]/g, "").trim();
              return text === value;
            }
        );
        if (targetOption) {
          targetOption.click();
        }
      }
    }, 200); // 200ms 视实际弹出速度调整
  }
}

// 填写表单数据
async function fillFormData(dataObj) {
  // 防止重复执行
  if (fillFormRunning) {
    return;
  }
  fillFormRunning = true;

  try {
    const pathImage = dataObj?.video?.video?.cover;
    if (!pathImage) {
      // alert('No cover image found');
      fillFormRunning = false;
      return;
    }

    setTimeout(async () => {
      // 标题
      const hasTitleEle = await waitForElement(".client_components_titleInput .input-container .input-box textarea");
      if (hasTitleEle) {
        const titleEle = document.querySelector(".client_components_titleInput .input-container .input-box textarea");
        setNativeValue(titleEle, dataObj.video.video.title);
      }

      // 设置封面为单图模式
      const hasSettingsWrapEle = await waitForElement("#bjhEditWrapSet");
      if (hasSettingsWrapEle) {
        const settingsWrapEle = document.querySelector("#bjhEditWrapSet");
        const hasCoverRadioEle = await waitForElement(".edit-cover-container");
        if (hasCoverRadioEle) {
          const coverRadioWrapEle = settingsWrapEle.querySelector(".edit-cover-container");
          const hasSingleRadioEle = await waitForElement('input[type="radio"]');
          if (hasSingleRadioEle) {
            const singleRadioEle = coverRadioWrapEle.querySelector('input[type="radio"][value="one"]');
            const threeRadioEle = coverRadioWrapEle.querySelector('input[type="radio"][value="three"]');
            setNativeValue(singleRadioEle, true);
            setNativeValue(threeRadioEle, false);
          }
        }

        //设置简介
        try {
          // 首先检查是否已经填写过（通过全局标记）
          if (introFilled) {
            console.log('[百家号发布] 简介已填写过，跳过');
          } else {
            console.log('[百家号发布] 开始填写简介...');
            const hasIntroEle = await waitForElement(".news_abstract_form_item textarea");
            console.log('[百家号发布] 简介元素是否存在:', hasIntroEle);
            if (hasIntroEle) {
              // 使用 document.querySelector 而不是 settingsWrapEle.querySelector，因为元素可能不在 settingsWrapEle 内
              const introEle = document.querySelector(".news_abstract_form_item textarea");
              console.log('[百家号发布] 简介输入框元素:', introEle);
              const targetIntro = dataObj.video.video.intro || '';
              const targetContent = targetIntro.trim();
              console.log('[百家号发布] 目标简介内容:', targetContent);

              // 检查实际内容
              const currentContent = (introEle?.value || '').trim();
              console.log('[百家号发布] 当前简介内容:', currentContent);

              // 只有在标记未设置且内容不同时才填写
              if (introEle && currentContent !== targetContent) {
                // 立即标记为已填写（在任何操作之前，防止并发）
                introFilled = true;
                console.log('[百家号发布] 正在填写简介...');
                setNativeValue(introEle, dataObj.video.video.intro);
                console.log('[百家号发布] ✅ 简介填写完成');
              } else if (!introEle) {
                console.log('[百家号发布] ❌ 简介输入框元素为空');
              } else {
                // 内容已经正确，也标记为已填写
                introFilled = true;
                console.log('[百家号发布] 简介内容已正确，无需修改');
              }
            } else {
              console.log('[百家号发布] ❌ 未找到简介元素 .news_abstract_form_item textarea');
            }
          }
        } catch (error) {
          console.log('[百家号发布] ❌ 简介填写失败:', error.message);
        }

        // 内容（带重试）
        setTimeout(async () => {
          try {
            await retryOperation(async () => {
              const hasIframeEle = await waitForElement("iframe");
              if (!hasIframeEle) {
                throw new Error('iframe 未找到');
              }
              const editorIframeEle = document.querySelector("iframe");
              const editorEle = editorIframeEle.contentWindow.document.querySelector(".news-editor-pc");
              if (!editorEle) {
                throw new Error('编辑器元素 .news-editor-pc 未找到');
              }
              editorEle.innerHTML = dataObj.video.video.content;
              editorEle.dispatchEvent(new Event("input", { bubbles: true }));
              console.log('[百家号发布] ✅ 内容填写完成');
            }, 3, 1000);
          } catch (e) {
            console.log('[百家号发布] ❌ 内容填写失败:', e.message);
          }
        }, 200);

        // 设置封面（使用主进程下载绕过跨域）
        await (async () => {
          try {
            const {blob, contentType} = await downloadFile(pathImage, 'image/png');
            var file = new File([blob], dataObj?.video?.formData?.title + ".png", {type: contentType || "image/png"});

            setTimeout(async () => {
              const changeBtn = document.querySelector(".actions-wrap .action:nth-of-type(2)");
              // alert(changeBtn)
              if (changeBtn) {
                changeBtn.click();
              } else {
                const hasCoverWrapEle = await waitForElement(".cover-list-one");
                if (hasCoverWrapEle) {
                  const coverWrapEle = settingsWrapEle.querySelector(".cover-list-one");
                  const coverImgEle = coverWrapEle.querySelector(".container");
                  coverImgEle.click();
                }
              }

              // 选中本地上传
              setTimeout(async () => {
                const hasLocalTabWrapEle = await waitForElement(".cheetah-tabs-nav-list");
                if (hasLocalTabWrapEle) {
                  const localTabWrapEle = document.querySelector(".cheetah-tabs-nav-list");
                  const localTabEle = localTabWrapEle.querySelector('div[data-node-key="choose-remote"] > div');
                  localTabEle.click();

                  setTimeout(async () => {
                    // 使用原生选择器获取元素
                    const hasInputEle = await waitForElement(".cheetah-upload input");
                    if (hasInputEle) {
                      const input = document.querySelector(".cheetah-upload input");
                      const dataTransfer = new DataTransfer();
                      // 创建 DataTransfer 对象模拟文件上传
                      dataTransfer.items.add(file);
                      input.files = dataTransfer.files;
                      const event = new Event("change", {bubbles: true});
                      input.dispatchEvent(event);

                      setTimeout(async () => {
                        const hasList = await waitForElement(".cheetah-ui-pro-base-image");
                        if (hasList) {
                          const confirmUploadBtnEle = document.querySelector(".cheetah-modal-footer button.cheetah-btn-primary");
                          confirmUploadBtnEle.click();
                          // 点击编辑图片的完成
                          setTimeout(async () => {
                            const hasEditBtn = await waitForElement(".cheetah-ui-pro-base-image");
                            if (hasEditBtn) {
                              const editImgBtnEle = document.querySelector(".bjh-pic-editor ._7Ojif");
                              editImgBtnEle.click();
                            }
                          }, 300);

                          setTimeout(async () => {
                            // 立即发布还是定时发布
                            const publishTime = dataObj.video.formData.send_set;
                            const hasScheduledBtnEle = await waitForElement(".editor-component-operator-wrapper.editor-component-operator .op-list-right > div:nth-last-of-type(2) button");
                            if (+publishTime === 2) {
                              //  定时发布
                              if (hasScheduledBtnEle) {
                                const scheduledBtnEle = document.querySelector(".editor-component-operator-wrapper.editor-component-operator .op-list-right > div:nth-last-of-type(2) button");
                                scheduledBtnEle.click();
                                setTimeout(() => {
                                  if (!dataObj.video.dyPlatform.send_time) return;
                                  const timestamp = new Date(dataObj.video.dyPlatform.send_time).getTime();

                                  //    获取月和日
                                  const month = new Date(timestamp).getMonth() + 1;
                                  const day = ("" + new Date(timestamp).getDate()).padStart(2, "0");
                                  const dateSelectorEle = document.querySelector(".timepublish-wrap-select > .select-wrap:first-of-type .cheetah-select-selection-item");
                                  getOptions(dateSelectorEle, month + "" + day);

                                  setTimeout(() => {
                                    //    获取时
                                    const hour = new Date(timestamp).getHours();
                                    const hourSelectorEle = document.querySelector(".timepublish-wrap-select > .select-wrap:nth-of-type(2) .cheetah-select-selection-item");
                                    getOptions(hourSelectorEle, hour + "");

                                    setTimeout(() => {
                                      //    获取分
                                      const minute = new Date(timestamp).getMinutes();
                                      const minuteSelectorEle = document.querySelector(".timepublish-wrap-select > .select-wrap:nth-of-type(3) .cheetah-select-selection-item");
                                      getOptions(minuteSelectorEle, minute + "");

                                      setTimeout(async () => {
                                        await publishApi(dataObj)
                                      }, 800);
                                    }, 2000);
                                  }, 2000);
                                }, 2000);
                              }
                            } else {
                              // 立即发布 - 先发送统计接口再点击发布按钮
                              const publishBtnEle = document.querySelector(".op-list-wrap-news .cheetah-btn-primary");

                              // 先发送统计接口
                              const scanData = {data: JSON.stringify({id: dataObj.video.dyPlatform.id})};
                              try {
                                await fetch("https://apidev.china9.cn/api/mediaauth/tjlog", {
                                  method: "POST",
                                  headers: {"Content-Type": "application/json"},
                                  body: JSON.stringify(scanData),
                                });
                              } catch (e) {
                              }

                              // 清理本地数据
                              localStorage.removeItem('articleContentPostData');

                              // 点击发布按钮（只点击一次）
                              if (publishBtnEle && publishBtnEle.offsetParent !== null) {
                                console.log('[百家号发布] 点击发布按钮');
                                publishBtnEle.click();
                              } else {
                                console.log('[百家号发布] 发布按钮不存在或不可见');
                              }

                              setTimeout(async () => {
                                // 点击确认按钮（只点击一次）
                                try {
                                  const confirmBtnEleTwo = document.querySelectorAll(".cheetah-modal-confirm-btns .cheetah-btn-primary");
                                  const finalBtn = confirmBtnEleTwo[confirmBtnEleTwo.length - 1];
                                  if (finalBtn && finalBtn.offsetParent !== null) {
                                    console.log('[百家号发布] 点击确认按钮');
                                    finalBtn.click();
                                  } else {
                                    console.log('[百家号发布] 确认按钮不存在或不可见');
                                  }
                                } catch (e) {
                                  console.log('[百家号发布] 确认按钮点击失败:', e.message);
                                }

                                // 发送成功消息并关闭窗口
                                sendMessageToParent('发布成功，刷新数据');
                                setTimeout(() => {
                                  try {
                                    window.browserAPI.closeCurrentWindow();
                                  } catch (e) {
                                    console.log('[百家号发布] 关闭窗口失败:', e);
                                  }
                                }, 3000);
                              }, 2000);
                            }
                          }, 1000);
                        }
                      }, 2000);
                    }
                  }, 1000);
                }
              }, 2000);
            }, 1000);
          } catch (error) {
            console.log('[百家号发布] ❌ 封面下载失败:', error);
          }
        })();
      }

      fillFormRunning = false;
      // alert('Automation process completed');
    }, 10000);

  } finally {
    // 无论成功还是失败，都重置标记
    fillFormRunning = false;
  }
}
