// SketchMasking 설정 페이지 스크립트

/**
 * 설정 스키마 정의
 */
const SETTINGS_SCHEMA = {
  // 그리기 모드 설정
  drawing: {
    lineColor: { type: 'color', default: '#FF0000', min: null, max: null },
    lineWidth: { type: 'number', default: 2, min: 1, max: 10 },
    toolbarCollapsed: { type: 'boolean', default: false, required: false }
  },

  // 텍스트 마스킹 설정
  textMasking: {
    maskingChar: { type: 'string', default: '*', min: 1, max: 1 }
  },

  // 영역 블러 설정
  areaBlur: {
    blurIntensity: { type: 'number', default: 10, min: 1, max: 10 }
  }
};

/**
 * 기본 설정값 생성
 */
function getDefaultSettings() {
  const defaultSettings = {};

  Object.keys(SETTINGS_SCHEMA).forEach(category => {
    defaultSettings[category] = {};
    Object.keys(SETTINGS_SCHEMA[category]).forEach(key => {
      defaultSettings[category][key] = SETTINGS_SCHEMA[category][key].default;
    });
  });

  return defaultSettings;
}

/**
 * 설정 관리 클래스
 */
class SettingsManager {
  constructor() {
    this.settings = {};
  }

  /**
   * 설정 초기화
   */
  async init() {
    try {
      await this.loadSettings();
      this.renderUI();
      console.log('설정 관리자가 초기화되었습니다.');
    } catch (error) {
      console.error('설정 관리자 초기화 실패:', error);
    }
  }

  /**
   * 설정 로드
   */
  async loadSettings() {
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['sketchMaskingSettings'], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      });

      // 저장된 설정이 있으면 기본값과 병합, 없으면 기본값 사용
      if (result.sketchMaskingSettings && typeof result.sketchMaskingSettings === 'object') {
        this.settings = this.mergeWithDefaults(result.sketchMaskingSettings);
      } else {
        this.settings = getDefaultSettings();
        // 처음 사용자를 위해 기본값을 저장
        await this.saveSettings();
      }

    } catch (error) {
      console.warn('설정 로드 실패, 기본값 사용:', error);
      this.settings = getDefaultSettings();
      // 오류가 발생했을 때도 기본값 저장 시도
      try {
        await this.saveSettings();
      } catch (saveError) {
        console.warn('기본값 저장 실패:', saveError);
      }
    }
  }

  /**
   * 저장된 설정과 기본값을 안전하게 병합
   */
  mergeWithDefaults(userSettings) {
    const defaultSettings = getDefaultSettings();
    const merged = JSON.parse(JSON.stringify(defaultSettings));

    // 각 카테고리별로 안전하게 병합
    Object.keys(SETTINGS_SCHEMA).forEach(category => {
      if (userSettings[category] && typeof userSettings[category] === 'object') {
        Object.keys(SETTINGS_SCHEMA[category]).forEach(key => {
          const userValue = userSettings[category][key];
          const schema = SETTINGS_SCHEMA[category][key];

          // 값이 존재하고 유효한 타입인지 확인
          if (userValue !== undefined && this.isValidType(userValue, schema.type)) {
            // 범위 검증 (min/max가 있는 경우)
            if (schema.min !== null && schema.max !== null) {
              if (userValue >= schema.min && userValue <= schema.max) {
                merged[category][key] = userValue;
              }
            } else {
              merged[category][key] = userValue;
            }
          }
        });
      }
    });

    return merged;
  }

  /**
   * 값의 타입이 유효한지 확인
   */
  isValidType(value, expectedType) {
    switch (expectedType) {
      case 'boolean':
        return typeof value === 'boolean';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'string':
        return typeof value === 'string';
      case 'color':
        return typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value);
      default:
        return false;
    }
  }

  /**
   * 설정 저장
   */
  async saveSettings() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ sketchMaskingSettings: this.settings }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('설정이 저장되었습니다:', this.settings);
          resolve();
        }
      });
    });
  }

  /**
   * 설정값 가져오기
   */
  getSetting(category, key) {
    return this.settings[category]?.[key];
  }

  /**
   * 설정값 변경
   */
  async setSetting(category, key, value) {
    if (!this.validateSetting(category, key, value)) {
      throw new Error(`유효하지 않은 설정값: ${category}.${key} = ${value}`);
    }

    if (!this.settings[category]) {
      this.settings[category] = {};
    }

    this.settings[category][key] = value;

    await this.saveSettings();
  }

  /**
   * 전체 설정 초기화 실행
   */
  async resetAllSettings() {
    try {
      // 기본 설정으로 복원
      this.settings = getDefaultSettings();

      // 저장소에서 설정 삭제 (기본값 사용)
      await new Promise((resolve, reject) => {
        chrome.storage.local.remove(['sketchMaskingSettings'], () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      // UI 재렌더링
      this.renderUI();

      // 성공 알림
      this.showResetNotification('✅ 모든 설정이 초기화되었습니다!', 'success');

      console.log('설정 초기화 완료');
    } catch (error) {
      console.error('설정 초기화 실패:', error);
      this.showResetNotification('❌ 설정 초기화에 실패했습니다.', 'error');
    }
  }

  /**
   * 초기화 알림 표시
   */
  showResetNotification(message, type = 'info') {
    // 기존 알림 제거
    const existing = document.getElementById('reset-notification');
    if (existing) {
      existing.remove();
    }

    // 알림 요소 생성
    const notification = document.createElement('div');
    notification.id = 'reset-notification';
    notification.className = `reset-notification ${type}`;
    notification.textContent = message;

    // 스타일 적용
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      font-weight: 500;
      font-size: 14px;
      z-index: 10000;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: all 0.3s ease;
      ${type === 'success' ?
        'background: #4CAF50; color: white; border: 1px solid #45a049;' :
        'background: #f44336; color: white; border: 1px solid #d32f2f;'
      }
    `;

    document.body.appendChild(notification);

    // 3초 후 자동 제거
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
          notification.remove();
        }, 300);
      }
    }, 3000);
  }

  /**
   * 설정값 검증
   */
  validateSetting(category, key, value) {
    const schema = SETTINGS_SCHEMA[category]?.[key];
    if (!schema) return false;

    switch (schema.type) {
      case 'boolean':
        return typeof value === 'boolean';
      case 'number':
        return typeof value === 'number' &&
          value >= schema.min &&
          value <= schema.max;
      case 'string':
        return typeof value === 'string' &&
          value.length >= schema.min &&
          value.length <= schema.max;
      case 'color':
        return /^#[0-9A-F]{6}$/i.test(value);
      default:
        return false;
    }
  }

  /**
   * UI 렌더링
   */
  renderUI() {
    const container = document.getElementById('settings-container');
    if (!container) return;

    container.innerHTML = this.generateSettingsHTML();
    this.bindUIEvents();
  }

  /**
   * 설정 HTML 생성
   */
  generateSettingsHTML() {
    return `
      ${this.generateDrawingSettings()}
      ${this.generateTextMaskingSettings()}
      ${this.generateAreaBlurSettings()}
      ${this.generateResetSection()}
    `;
  }

  generateDrawingSettings() {
    return `
      <div class="section">
        <div class="section-title">🎨 그리기 모드 설정</div>
        
        <div class="setting-items">
          <div class="setting-item">
            <label for="drawing-lineColor">선 색상</label>
            <div class="color-input-wrapper">
              <input type="color" id="drawing-lineColor" value="${this.getSetting('drawing', 'lineColor')}">
              <span class="color-value">${this.getSetting('drawing', 'lineColor')}</span>
            </div>
          </div>
          
          <div class="setting-item">
            <label for="drawing-lineWidth">선 굵기 (${this.getSetting('drawing', 'lineWidth')}px)</label>
            <div class="range-input-wrapper">
              <input type="range" id="drawing-lineWidth" min="1" max="10" value="${this.getSetting('drawing', 'lineWidth')}">
              <div class="range-labels">
                <span>1px</span>
                <span>10px</span>
              </div>
            </div>
          </div>
          
          <div class="setting-item">
            <label class="toggle-label">
              <input type="checkbox" id="drawing-toolbarCollapsed" ${this.getSetting('drawing', 'toolbarCollapsed') ? 'checked' : ''}>
              도구 모음 기본 접힘 상태
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  generateTextMaskingSettings() {
    return `
      <div class="section">
        <div class="section-title">🔒 텍스트 마스킹 설정</div>
        
        <div class="setting-item">
          <label for="textMasking-maskingChar">마스킹 문자</label>
          <div class="char-input-wrapper">
            <input type="text" id="textMasking-maskingChar" value="${this.getSetting('textMasking', 'maskingChar')}" maxlength="1" placeholder="*">
            <span class="char-preview">미리보기: ${this.getSetting('textMasking', 'maskingChar').repeat(5)}</span>
          </div>
        </div>
      </div>
    `;
  }

  generateAreaBlurSettings() {
    return `
      <div class="section">
        <div class="section-title">🔍 영역 블러 설정</div>
        
        <div class="setting-item">
          <label for="areaBlur-blurIntensity">블러 강도 (${this.getSetting('areaBlur', 'blurIntensity')}px)</label>
          <div class="range-input-wrapper">
            <input type="range" id="areaBlur-blurIntensity" min="1" max="10" value="${this.getSetting('areaBlur', 'blurIntensity')}">
            <div class="range-labels">
              <span>1px</span>
              <span>10px</span>
            </div>
          </div>
          <div class="blur-preview">
            <div class="blur-sample" style="backdrop-filter: blur(${this.getSetting('areaBlur', 'blurIntensity')}px); font-size: 30px;">
              블러 테스트
            </div>
          </div>
        </div>
      </div>
    `;
  }

  generateResetSection() {
    return `
      <div class="section reset-section">
        <div class="section-title">🔄 설정 초기화</div>
        
        <div class="setting-item">
          <div class="reset-description">
            모든 설정을 기본값으로 되돌립니다:
            <ul>
              <li><strong>그리기 모드:</strong> 빨간색, 2px 굵기, 도구바 펼침</li>
              <li><strong>텍스트 마스킹:</strong> * 문자</li>
              <li><strong>영역 블러:</strong> 10px 강도</li>
            </ul>
          </div>
          
          <button id="reset-all-settings" class="reset-button">
            🔄 전체 초기화
          </button>
          
          <div class="reset-warning">
            ⚠️ 이 작업은 되돌릴 수 없습니다.
          </div>
        </div>
      </div>
    `;
  }

  /**
   * UI 이벤트 바인딩
   */
  bindUIEvents() {
    // 그리기 설정
    document.getElementById('drawing-lineColor')?.addEventListener('change', (e) => {
      this.setSetting('drawing', 'lineColor', e.target.value);
      document.querySelector('.color-value').textContent = e.target.value;
    });

    document.getElementById('drawing-lineWidth')?.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setSetting('drawing', 'lineWidth', value);
      document.querySelector('label[for="drawing-lineWidth"]').textContent = `선 굵기 (${value}px)`;
    });

    document.getElementById('drawing-toolbarCollapsed')?.addEventListener('change', (e) => {
      this.setSetting('drawing', 'toolbarCollapsed', e.target.checked);
    });

    // 텍스트 마스킹 설정
    document.getElementById('textMasking-maskingChar')?.addEventListener('input', (e) => {
      const value = e.target.value.slice(-1) || '*'; // 마지막 문자만 사용
      e.target.value = value;
      this.setSetting('textMasking', 'maskingChar', value);
      document.querySelector('.char-preview').textContent = `미리보기: ${value.repeat(5)}`;
    });

    // 영역 블러 설정
    document.getElementById('areaBlur-blurIntensity')?.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setSetting('areaBlur', 'blurIntensity', value);
      document.querySelector('label[for="areaBlur-blurIntensity"]').textContent = `블러 강도 (${value}px)`;

      const blurSample = document.querySelector('.blur-sample');
      if (blurSample) {
        blurSample.style.backdropFilter = `blur(${value}px)`;
        blurSample.style.fontSize = '30px'; // 폰트 크기 30px로 고정
      }
    });

    // 전체 초기화 버튼
    document.getElementById('reset-all-settings')?.addEventListener('click', () => {
      this.resetAllSettings();
    });
  }

  /**
   * UI 업데이트
   */
  updateUI(category, key, value) {
    const element = document.getElementById(`${category}-${key}`);
    if (element) {
      if (element.type === 'checkbox') {
        element.checked = value;
      } else {
        element.value = value;
      }
    }
  }

}

// 전역 설정 관리자 인스턴스
let settingsManager;

document.addEventListener('DOMContentLoaded', async function () {
  console.log('SketchMasking 설정 페이지가 로드되었습니다.');

  settingsManager = new SettingsManager();
  await settingsManager.init();

  // 커피 사주기 토글 기능 초기화
  initCoffeeToggle();
});

/**
 * 커피 사주기 토글 기능 초기화
 */
function initCoffeeToggle() {
  const coffeeToggleBtn = document.getElementById('coffee-toggle-btn');
  const coffeeQrContainer = document.getElementById('coffee-qr');

  if (!coffeeToggleBtn || !coffeeQrContainer) {
    console.warn('커피 사주기 요소를 찾을 수 없습니다.');
    return;
  }

  let isQrVisible = false;

  coffeeToggleBtn.addEventListener('click', function () {
    if (isQrVisible) {
      // QR 코드 숨기기
      coffeeQrContainer.classList.remove('show');
      coffeeToggleBtn.textContent = '☕ 개발자 커피 사주기';

      // 애니메이션 완료 후 display none 설정
      setTimeout(() => {
        coffeeQrContainer.style.display = 'none';
      }, 400);

      isQrVisible = false;
    } else {
      // QR 코드 보이기
      coffeeQrContainer.style.display = 'block';
      coffeeToggleBtn.textContent = '❌ 닫기';

      // 약간의 지연 후 애니메이션 클래스 추가
      setTimeout(() => {
        coffeeQrContainer.classList.add('show');
      }, 10);

      isQrVisible = true;
    }
  });
}

// 설정 관리자를 전역으로 노출 (디버깅 및 확장용)
window.SketchMaskingSettings = {
  getManager: () => settingsManager,
  getSettings: () => settingsManager?.settings,
  getSetting: (category, key) => settingsManager?.getSetting(category, key)
};