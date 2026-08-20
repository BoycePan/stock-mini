import { bindTheme, unbindTheme } from '../../utils/theme'
import { rootStore } from '../../stores/root.store'

interface LegalSection {
  heading: string
  paragraphs: string[]
}

interface LegalDoc {
  key: string
  title: string
  icon: string
  intro: string[]
  updatedAt?: string
  detailsHeading?: string
  sections?: LegalSection[]
  closing?: string[]
}

const LEGAL_DOCS: Record<string, LegalDoc> = {
  'data-notice': {
    key: 'data-notice',
    title: '数据说明',
    icon: '📊',
    updatedAt: '2026-08-19',
    intro: [
      '本小程序聚合展示全球宏观环境、产业趋势与行业景气度信息，帮助用户建立跨市场的宏观视野。数据来源于第三方公开接口及公开信息，经整理后展示，仅供信息参考之用。',
    ],
    detailsHeading: '数据来源与使用说明',
    sections: [
      {
        heading: '一、数据来源',
        paragraphs: [
          '本小程序展示的行情参考数据（包括但不限于商品价格、汇率、股票指数涨跌幅等），来源于第三方公开接口（如新浪财经、雅虎财经等），经转发整理后呈现。',
        ],
      },
      {
        heading: '二、数据时效',
        paragraphs: [
          '受接口延迟、网络状况及数据提供方更新频率影响，本小程序显示的数据可能存在一定延迟（通常为 15 分钟至数小时不等）。行情数据仅供参考，不代表实时成交价格。',
        ],
      },
      {
        heading: '三、准确性说明',
        paragraphs: [
          '本小程序不对数据的实时性、准确性及完整性作出任何保证。如需精确数据，请以各交易所、监管机构或官方平台的发布信息为准。',
        ],
      },
      {
        heading: '四、本地缓存',
        paragraphs: [
          '在网络异常情况下，小程序将展示本地缓存的最近一次数据快照，并在界面中显著标注。用户在恢复网络后可手动刷新以获取最新数据。',
        ],
      },
    ],
    closing: ['以上说明旨在帮助你合理理解和使用本小程序的数据，感谢你的信任与支持。'],
  },
  disclaimer: {
    key: 'disclaimer',
    title: '免责声明',
    icon: '⚠️',
    updatedAt: '2026-08-19',
    intro: [
      '本小程序仅提供宏观环境、产业趋势与行业景气度的信息展示，不涉及证券交易或任何形式的金融服务。所有内容均基于公开数据整理，仅供参考，不构成任何投资建议或决策依据。',
    ],
    detailsHeading: '详细免责条款',
    sections: [
      {
        heading: '一、数据来源与时效',
        paragraphs: [
          '本小程序展示的行情参考数据来源于第三方公开接口，可能存在延迟、中断、错误或与官方数据不一致的情况，不保证其实时性、准确性与完整性。',
        ],
      },
      {
        heading: '二、非投资建议',
        paragraphs: [
          '本小程序所有内容仅供信息参考，不构成任何投资建议、要约邀请或交易保证。任何依据本小程序信息所作出的投资决策及其产生的盈亏，均由用户自行承担。',
        ],
      },
      {
        heading: '三、风险提示',
        paragraphs: [
          '投资有风险，入市须谨慎。证券及金融衍生品价格波动剧烈，过往表现不代表未来收益。境外证券市场还存在汇率波动、政策调整、时差等额外风险，请在充分了解风险后审慎决策。',
        ],
      },
      {
        heading: '四、责任限制',
        paragraphs: [
          '因数据延迟、错误、中断、网络故障、第三方接口变更或不可抗力等原因导致的任何直接或间接损失，本小程序及开发者不承担任何法律责任。',
        ],
      },
      {
        heading: '五、知识产权',
        paragraphs: [
          '行情数据的相关权利归原数据提供方及对应交易所所有，本小程序不对任何数据主张权利，仅作信息聚合展示之用。',
        ],
      },
    ],
    closing: ['继续使用本小程序，即表示你已阅读、理解并接受上述全部免责内容。'],
  },
  agreement: {
    key: 'agreement',
    title: '用户协议',
    icon: '📄',
    updatedAt: '2026-08-19',
    intro: [
      '欢迎使用市场追踪助手（以下简称"本小程序"）。在开始使用前，请仔细阅读本协议。使用本小程序即视为你已阅读并同意本协议全部内容。',
    ],
    sections: [
      {
        heading: '一、服务内容',
        paragraphs: [
          '本小程序提供全球宏观环境、产业变化、行业景气程度及公开市场参考数据的整理与展示服务，帮助用户了解跨市场的宏观趋势。本小程序不提供证券交易或任何形式的金融服务。',
        ],
      },
      {
        heading: '二、数据来源与准确性',
        paragraphs: [
          '本小程序展示的数据来源于第三方公开接口或公开信息，经整理后展示。数据可能存在延迟、中断或缺失，不保证实时性、准确性及完整性，请以官方渠道信息为准。',
        ],
      },
      {
        heading: '三、信息性质与决策责任',
        paragraphs: [
          '本小程序全部内容仅供参考，不构成任何投资建议、要约或保证。任何依据本小程序信息作出的投资决策及产生的盈亏，均由用户自行承担。',
        ],
      },
      {
        heading: '四、用户行为规范',
        paragraphs: [
          '用户不得利用本小程序从事违反法律法规或损害他人合法权益的行为，包括但不限于恶意抓取数据、干扰服务正常运行、传播违法信息等。因用户违规行为造成的损失，由用户自行承担。',
        ],
      },
      {
        heading: '五、知识产权',
        paragraphs: [
          '本小程序的界面设计、程序代码及相关内容的知识产权归开发者所有；行情数据的相关权利归原数据提供方及交易所所有，本小程序仅作信息聚合展示之用。',
        ],
      },
      {
        heading: '六、协议变更',
        paragraphs: [
          '本协议可能适时更新，更新后将在本页面公布。继续使用本小程序即视为接受更新后的协议。',
        ],
      },
      {
        heading: '七、联系我们',
        paragraphs: [
          '如对本协议有任何疑问，欢迎通过以下方式联系我们：添加微信 wxid_17d7dcibooe021 或 BoycePan0606。',
        ],
      },
    ],
    closing: ['继续使用本小程序，即表示你已阅读、理解并同意本协议全部内容。'],
  },
  privacy: {
    key: 'privacy',
    title: '隐私政策',
    icon: '🔒',
    updatedAt: '2026-08-19',
    intro: [
      '我们非常重视你的隐私与数据安全。本政策说明本小程序如何处理与你相关的信息，请在使用前仔细阅读。',
    ],
    sections: [
      {
        heading: '一、我们收集与使用的信息',
        paragraphs: [
          '为实现基本功能，我们会在你授权登录后，通过微信获取你的基本昵称和头像，仅用于在设置页展示个人信息。以下偏好数据仅存储在设备本地，不会上传服务器：自选/关注列表；主题模式等界面偏好设置；上次成功获取的行情快照（供网络异常时展示）。',
        ],
      },
      {
        heading: '二、我们不收集的信息',
        paragraphs: [
          '我们不收集你的手机号、位置、通讯录、相册等敏感个人信息，也不使用任何用户行为追踪或广告 SDK。',
        ],
      },
      {
        heading: '三、网络请求与第三方',
        paragraphs: [
          '为获取行情数据，我们会通过自有后端请求第三方公开行情接口（如新浪财经、雅虎财经等）。该请求仅用于拉取公开市场数据，不包含你的任何个人信息。第三方对其数据的处理适用其自身隐私政策。',
        ],
      },
      {
        heading: '四、信息存储与你的权利',
        paragraphs: [
          '本地偏好数据仅存储于你的设备中。你可以随时在小程序内修改设置或取消关注，也可通过微信"删除小程序"或"清除缓存"功能清空全部本地数据。',
        ],
      },
      {
        heading: '五、未成年人保护',
        paragraphs: ['本小程序面向成年人提供服务。若你是未成年人，请在监护人的指导下使用。'],
      },
      {
        heading: '六、政策更新',
        paragraphs: [
          '本政策可能适时更新，更新后将在本页面公布。继续使用本小程序即视为接受更新后的政策。',
        ],
      },
      {
        heading: '七、联系我们',
        paragraphs: [
          '如对本政策有任何疑问，欢迎通过以下方式联系我们：添加微信 wxid_17d7dcibooe021 或 BoycePan0606。',
        ],
      },
    ],
  },
}

const DEFAULT_DOC: LegalDoc = {
  key: 'unknown',
  title: '内容不存在',
  icon: '❓',
  intro: ['未找到对应内容，请返回设置页重试。'],
}

Page({
  data: {
    theme: rootStore.settings.theme,
    title: '',
    docIcon: '',
    updatedAt: '',
    detailsHeading: '',
    intro: [] as string[],
    sections: [] as LegalSection[],
    closing: [] as string[],
  },
  onLoad(options: Record<string, string | undefined>) {
    bindTheme(this)
    const type = options.type || ''
    this.applyDoc(LEGAL_DOCS[type] ?? DEFAULT_DOC)
  },
  onUnload() {
    unbindTheme(this)
  },
  applyDoc(doc: LegalDoc) {
    this.setData({
      title: doc.title,
      docIcon: doc.icon,
      updatedAt: doc.updatedAt || '',
      detailsHeading: doc.detailsHeading || '',
      intro: doc.intro,
      sections: doc.sections || [],
      closing: doc.closing || [],
    })
  },
})
