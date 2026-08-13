import { bindTheme, unbindTheme } from '../../utils/theme'
import { rootStore } from '../../stores/root.store'

interface LegalSection {
  heading: string
  paragraphs: string[]
}

interface LegalDoc {
  key: string
  title: string
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
    intro: [
      '本小程序依据公开信息，对不同国家和地区的宏观环境、产业变化及行业景气程度进行整理展示，帮助用户了解行业发展趋势。相关内容可能存在延迟、缺失或统计偏差，请以实际情况为准。',
    ],
  },
  disclaimer: {
    key: 'disclaimer',
    title: '免责声明',
    updatedAt: '2026-06-15',
    intro: [
      '本小程序不涉及任何股票、期货行情，不提供证券交易或相关金融服务，仅用于展示宏观环境、产业变化与行业景气程度。本小程序内容仅用于行业信息展示、知识交流和趋势观察，不构成专业意见或决策依据。用户应结合实际情况独立判断，本小程序不对因使用相关内容产生的结果承担责任。',
    ],
    detailsHeading: '免责声明与风险提示',
    sections: [
      {
        heading: '一、数据来源与时效',
        paragraphs: [
          '本小程序展示的公开市场参考数据（如商品、汇率、行业涨跌等），来源于第三方公开接口，经转发展示。数据可能存在延迟、中断、错误或与官方数据不一致的情况，不保证其实时性、准确性、完整性。',
        ],
      },
      {
        heading: '二、非投资建议',
        paragraphs: [
          '本小程序仅提供行情信息的浏览与展示，所有内容仅供参考，不构成任何投资建议、要约、招揽或保证。任何依据本小程序信息所作出的投资决策及由此产生的盈亏，均由用户自行承担。',
        ],
      },
      {
        heading: '三、风险提示',
        paragraphs: [
          '投资有风险，入市需谨慎。证券及金融衍生品价格波动剧烈，过往表现不代表未来收益。境外证券市场还存在汇率、政策、时差等额外风险。请在充分了解相关风险后审慎决策。',
        ],
      },
      {
        heading: '四、责任限制',
        paragraphs: [
          '因数据延迟、错误、中断、网络故障、第三方接口变更或不可抗力等原因导致的任何直接或间接损失，本小程序及开发者不承担责任。',
        ],
      },
      {
        heading: '五、知识产权',
        paragraphs: [
          '行情数据的相关权利归原数据提供方及交易所所有。本小程序不对数据主张任何权利，仅作信息聚合展示之用。',
        ],
      },
    ],
    closing: ['继续使用本小程序，即表示你已阅读、理解并同意上述全部内容。'],
  },
  agreement: {
    key: 'agreement',
    title: '用户协议',
    updatedAt: '2026-06-15',
    intro: [
      '欢迎使用全球市场追踪小程序（以下简称"本小程序"）。在访问或使用本小程序前，请仔细阅读并充分理解本协议。你开始使用本小程序，即视为你已阅读、理解并同意本协议的全部内容。',
    ],
    sections: [
      {
        heading: '一、服务内容',
        paragraphs: [
          '本小程序提供不同国家和地区的宏观环境、产业变化、行业景气程度及公开市场参考数据（如商品、汇率、行业涨跌等）的整理与展示服务，帮助用户了解行业发展趋势。本小程序不提供证券交易或任何形式的金融服务。',
        ],
      },
      {
        heading: '二、数据来源与准确性',
        paragraphs: [
          '本小程序展示的数据来源于第三方公开接口或公开信息，经整理后展示。数据可能存在延迟、中断、错误或缺失，本小程序不保证其实时性、准确性及完整性，用户应以官方渠道信息为准。',
        ],
      },
      {
        heading: '三、信息性质与决策责任',
        paragraphs: [
          '本小程序的全部内容仅供参考，不构成任何投资建议、要约、招揽或保证。任何依据本小程序信息所作出的投资决策及由此产生的盈亏，均由用户自行承担。',
        ],
      },
      {
        heading: '四、用户行为规范',
        paragraphs: [
          '用户不得利用本小程序从事任何违反法律法规或损害他人合法权益的行为，包括但不限于恶意抓取数据、干扰服务正常运行、发布违法信息等。如因用户违规行为造成损失的，由用户承担相应责任。',
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
          '本协议可能适时更新。更新后的协议将在本页面公布，继续使用本小程序即视为接受更新后的协议。',
        ],
      },
      {
        heading: '七、联系我们',
        paragraphs: [
          '如对本协议有任何疑问，可添加微信wxid_17d7dcibooe021或BoycePan0606， 与我们联系。',
        ],
      },
    ],
    closing: ['继续使用本小程序，即表示你已阅读、理解并同意本协议全部内容。'],
  },
  privacy: {
    key: 'privacy',
    title: '隐私政策',
    updatedAt: '2026-06-15',
    intro: [
      '本小程序（以下简称"我们"）非常重视你的隐私。本政策说明我们如何处理与你相关的信息。本小程序无需注册或登录，不收集你的个人身份信息。',
    ],
    sections: [
      {
        heading: '一、我们收集与使用的信息',
        paragraphs: [
          '为实现基本功能，我们仅在你的设备本地保存以下信息，不会上传到我们的服务器：自选/关注列表；涨跌配色、刷新频率等偏好设置；上次成功获取的行情快照（用于网络异常时显示）。',
        ],
      },
      {
        heading: '二、我们不收集的信息',
        paragraphs: [
          '我们不收集你的微信账号、手机号、位置、通讯录、相册等任何个人信息，也不使用任何用户行为追踪或广告 SDK。',
        ],
      },
      {
        heading: '三、网络请求与第三方',
        paragraphs: [
          '为获取行情，我们会通过云函数或自有后端请求第三方公开行情接口（如新浪财经、雅虎财经等）。该请求不包含你的任何个人信息，仅用于拉取公开市场数据。第三方对其数据的处理适用其自身政策。',
        ],
      },
      {
        heading: '四、信息存储与你的权利',
        paragraphs: [
          '上述本地数据仅存于你的设备。你可以随时在小程序内取消关注、修改设置，或通过微信"删除小程序/清除缓存"清空全部本地数据。',
        ],
      },
      {
        heading: '五、未成年人保护',
        paragraphs: ['本小程序面向成年人。若你是未成年人，请在监护人指导下使用。'],
      },
      {
        heading: '六、政策更新',
        paragraphs: ['本政策可能适时更新，更新后将在本页面公布。继续使用即视为接受更新后的政策。'],
      },
      {
        heading: '七、联系我们',
        paragraphs: [
          '如对本政策有任何疑问，可添加微信wxid_17d7dcibooe021或BoycePan0606，与我们联系。',
        ],
      },
    ],
  },
}

const DEFAULT_DOC: LegalDoc = {
  key: 'unknown',
  title: '内容不存在',
  intro: ['未找到对应内容，请返回设置页重试。'],
}

Page({
  data: {
    theme: rootStore.settings.theme,
    title: '',
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
      updatedAt: doc.updatedAt || '',
      detailsHeading: doc.detailsHeading || '',
      intro: doc.intro,
      sections: doc.sections || [],
      closing: doc.closing || [],
    })
  },
})
