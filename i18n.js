/**
 * 다국어 지원 관리 모듈
 */
class I18nManager {
  constructor() {
    this.currentLanguage = null;
    this.fallbackLanguage = 'en';
    this.messages = {}; // 로드된 메시지 저장
    this.supportedLanguages = {
      'auto': { code: 'auto', name: '🌐 Auto Detect' },
      'ko': { code: 'ko', name: '🇰🇷 한국어' },
      'en': { code: 'en', name: '🇺🇸 English' }
    };
  }

  /**
   * 초기화 및 현재 사용할 언어 결정
   */
  async init() {
    await this.determineLanguage();
    await this.loadMessages(this.currentLanguage);
    return this.currentLanguage;
  }

  /**
   * 현재 사용할 언어 결정
   */
  async determineLanguage() {
    try {
      // 사용자가 설정한 언어 확인
      const settings = await this.getStoredSettings();
      const userSelectedLanguage = settings?.language?.selectedLanguage;

      if (userSelectedLanguage && userSelectedLanguage !== 'auto') {
        this.currentLanguage = userSelectedLanguage;
        return this.currentLanguage;
      }

      // 'auto'이거나 설정이 없는 경우 브라우저 언어 감지
      const browserLanguage = this.detectBrowserLanguage();
      this.currentLanguage = browserLanguage;

      return this.currentLanguage;
    } catch (error) {
      console.warn('언어 감지 실패, 기본 언어 사용:', error);
      this.currentLanguage = this.fallbackLanguage;
      return this.currentLanguage;
    }
  }

  /**
   * 브라우저 언어 감지
   */
  detectBrowserLanguage() {
    // Chrome i18n API로 브라우저 언어 확인
    const browserLang = chrome.i18n.getUILanguage();

    // 지원하는 언어 목록에서 확인
    const supportedLangCodes = Object.keys(this.supportedLanguages).filter(code => code !== 'auto');

    // 정확한 매치 확인 (예: 'ko')
    if (supportedLangCodes.includes(browserLang)) {
      return browserLang;
    }

    // 언어 코드의 첫 부분만 확인 (예: 'ko-KR' -> 'ko')
    const primaryLang = browserLang.split('-')[0].toLowerCase();
    if (supportedLangCodes.includes(primaryLang)) {
      return primaryLang;
    }

    // 지원하지 않는 언어인 경우 영어로 폴백
    return this.fallbackLanguage;
  }

  /**
   * 저장된 설정 가져오기
   */
  async getStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['sketchMaskingSettings'], (result) => {
        resolve(result.sketchMaskingSettings || {});
      });
    });
  }

  /**
   * 언어별 메시지 파일 로드
   */
  async loadMessages(language) {
    try {
      const url = chrome.runtime.getURL(`_locales/${language}/messages.json`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to load messages for ${language}`);
      }

      const data = await response.json();
      this.messages = data;

      console.log(`메시지 로드 완료: ${language}`, Object.keys(this.messages).length, '개');
    } catch (error) {
      console.warn(`${language} 메시지 로드 실패, 폴백 언어 시도:`, error);

      // 폴백 언어로 재시도
      if (language !== this.fallbackLanguage) {
        try {
          const url = chrome.runtime.getURL(`_locales/${this.fallbackLanguage}/messages.json`);
          const response = await fetch(url);
          const data = await response.json();
          this.messages = data;
          console.log(`폴백 메시지 로드 완료: ${this.fallbackLanguage}`);
        } catch (fallbackError) {
          console.error('폴백 메시지 로드도 실패:', fallbackError);
          this.messages = {};
        }
      }
    }
  }

  /**
   * 언어별 메시지 가져오기
   */
  getMessage(key, substitutions = null) {
    try {
      // 로드된 메시지에서 찾기
      const messageData = this.messages[key];

      if (!messageData || !messageData.message) {
        console.warn(`메시지 키 '${key}'를 찾을 수 없습니다`);
        return key;
      }

      let message = messageData.message;

      // substitutions 처리 (Chrome i18n 형식: $1, $2, ...)
      if (substitutions) {
        if (Array.isArray(substitutions)) {
          substitutions.forEach((sub, index) => {
            message = message.replace(new RegExp(`\\$${index + 1}`, 'g'), sub);
          });
        } else {
          message = message.replace(/\$1/g, substitutions);
        }
      }

      return message;
    } catch (error) {
      console.warn(`메시지 키 '${key}' 처리 실패:`, error);
      return key;
    }
  }

  /**
   * 현재 언어로 페이지 현지화
   */
  localizePage() {
    // data-i18n 속성을 가진 모든 요소 처리
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      const message = this.getMessage(key);

      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        if (element.type === 'button' || element.type === 'submit') {
          element.value = message;
        } else {
          element.placeholder = message;
        }
      } else {
        element.textContent = message;
      }
    });

    // data-i18n-html 속성을 가진 요소들 처리 (HTML 포함)
    document.querySelectorAll('[data-i18n-html]').forEach(element => {
      const key = element.getAttribute('data-i18n-html');
      const message = this.getMessage(key);
      element.innerHTML = message;
    });

    // title 속성 현지화
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      const message = this.getMessage(key);
      element.title = message;
    });

    // 페이지 제목 현지화
    const titleKey = document.documentElement.getAttribute('data-i18n-title');
    if (titleKey) {
      document.title = this.getMessage(titleKey);
    }
  }

  /**
   * 동적으로 텍스트 현지화
   */
  t(key, substitutions = null) {
    return this.getMessage(key, substitutions);
  }

  /**
   * 현재 언어 코드 반환
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * 지원하는 언어 목록 반환
   */
  getSupportedLanguages() {
    return this.supportedLanguages;
  }
}

// 전역으로 사용 가능하도록 export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18nManager;
}

