import { Context, Schema, Logger, h, sleep } from 'koishi'
import * as path from 'path'
import { mkdir, writeFile, unlink, rm, readFile } from 'fs/promises' 
import * as crypto from 'crypto'
import { pathToFileURL } from 'url'
import { Recipe } from 'muhammara'
import sharp from 'sharp'

export const name = 'pica-comics'
export const inject = {
  required: ['http'],
}

const logger = new Logger(name)

// --- 配置项定义 ---
export interface Config {
  username?: string 
  password?: string
  useForwardForSearch: boolean
  useForwardForImages: boolean
  showImageInSearch: boolean
  downloadPath: string
  defaultToPdf: boolean
  pdfPassword?: string
  enableCompression: boolean
  compressionQuality: number
  pdfSendMethod: 'buffer' | 'file'
  apiHost: string
  apiKey: string
  hmacKey: string
  debug: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    username: Schema.string().description('PicACG 的登录用户名（注意：不是昵称）。').required(),
    password: Schema.string().description('PicACG 的登录密码。').role('secret').required(),
  }).description('账号设置'),

  Schema.object({
    useForwardForSearch: Schema.boolean().description('【QQ平台】是否默认使用合并转发的形式发送【搜索结果】。').default(true),
    useForwardForImages: Schema.boolean().description('【QQ平台】当以图片形式发送漫画时，是否默认使用【合并转发】。').default(true),
    showImageInSearch: Schema.boolean().description('是否在【搜索结果】中显示封面图片。注意：在合并转发模式下，开启此项可能会因消息过长导致发送失败。').default(true),
  }).description('消息发送设置'),
  
  Schema.object({
    downloadPath: Schema.string().description('PDF 文件和临时文件的保存目录。').default('./data/downloads/picacg'),
    defaultToPdf: Schema.boolean().description('是否默认将漫画下载为 PDF 文件。').default(true),
    pdfPassword: Schema.string().role('secret').description('（可选）为生成的 PDF 文件设置一个打开密码。留空则不加密。'),
    enableCompression: Schema.boolean().description('【PDF模式】是否启用图片压缩以减小 PDF 文件体积。').default(true),
    compressionQuality: Schema.number().min(1).max(100).step(1).role('slider').default(80)
      .description('【PDF模式】JPEG 图片质量 (1-100)。'),
    pdfSendMethod: Schema.union([
      Schema.const('buffer').description('Buffer (内存模式，最高兼容性)'),
      Schema.const('file').description('File (文件路径模式，低兼容性)'),
    ]).description('PDF 发送方式。如果 Koishi 与机器人客户端 (如 Napcat) 不在同一台设备或 Docker 环境中，必须选择“Buffer”。').default('buffer'),
  }).description('PDF 输出设置'),

  Schema.object({
    debug: Schema.boolean().description('是否在控制台输出详细的调试日志。用于排查问题。').default(false),
  }).description('调试设置'),

  Schema.object({
    apiHost: Schema.string().description('PicACG API 服务器地址。').default('https://picaapi.picacomic.com'),
    apiKey: Schema.string().role('secret').description('PicACG API Key。').default('C69BAF41DA5ABD1FFEDC6D2FEA56B'),
    hmacKey: Schema.string().role('secret').description('PicACG HMAC 签名密钥。').default('~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn'),
  }).description('高级设置 (警告：除非你知道你在做什么，否则不要修改这些值！)'),
])

// --- 主入口函数 ---
export function apply(ctx: Context, config: Config) {
  let token: string | null = null
  let tokenExpiry: number = 0

  function createSignature(path: string, nonce: string, time: string, method: string): string {
    const raw = path + time + nonce + method + config.apiKey
    return crypto.createHmac('sha256', config.hmacKey)
      .update(raw.toLowerCase()).digest('hex')
  }

  function buildHeaders(method: string, path: string, authToken?: string) {
    const time = Math.floor(Date.now() / 1000).toString()
    const nonce = crypto.randomUUID().replace(/-/g, '')
    const signature = createSignature(path, nonce, time, method)
    return {
      'api-key': config.apiKey, 'accept': 'application/vnd.picacomic.com.v1+json', 'app-channel': '2',
      'time': time, 'nonce': nonce, 'signature': signature, 'app-version': '2.2.1.3.3.4',
      'app-uuid': 'defaultUuid', 'image-quality': 'original', 'app-platform': 'android',
      'app-build-version': '45', 'Content-Type': 'application/json; charset=UTF-8',
      'user-agent': 'okhttp/3.8.1', ...(authToken && { 'authorization': authToken }),
    }
  }

  async function login(): Promise<void> {
    const path = 'auth/sign-in'
    const headers = buildHeaders('POST', path)
    try {
      const response = await ctx.http.post(`${config.apiHost}/${path}`, {
        email: config.username, 
        password: config.password,
      }, { headers })

      if (response?.data?.token) {
        token = response.data.token
        tokenExpiry = Date.now() + 24 * 60 * 60 * 1000

        if (config.debug) logger.info('登录成功！')
      } else {
        logger.warn('登录失败，API 返回数据无效:', response?.data)
      }
    } catch (error) {
      logger.error('登录请求网络失败:', error.response?.data || error.message)
    }
  }

  async function ensureToken(): Promise<string | null> {
    if (token && Date.now() < tokenExpiry) return token
    await login()
    return token
  }
  
  async function getComicInfo(comicId: string): Promise<{ title: string } | null> {
    const authToken = await ensureToken();
    if (!authToken) return null;
    const path = `comics/${comicId}`;
    const headers = buildHeaders('GET', path, authToken);
    try {
        const response = await ctx.http.get(`${config.apiHost}/${path}`, { headers });
        return response?.data?.comic;
    } catch (error) {
        logger.warn(`[详情] 获取漫画信息失败。ID: ${comicId}`, { error: error.response?.data || error.message });
        return null;
    }
  }

  async function getComicChapters(comicId: string): Promise<{ order: number, id: string }[]> {
    const authToken = await ensureToken();
    if (!authToken) return [];
    
    const path = `comics/${comicId}/eps`
    let allChapters: { order: number, id: string }[] = []
    let currentPage = 1
    let totalPages = 1
    
    do {
      const requestPath = `${path}?page=${currentPage}`
      const headers = buildHeaders('GET', requestPath, authToken)
      const response = await ctx.http.get(`${config.apiHost}/${requestPath}`, { headers })
      
      const chapterData = response.data?.eps
      if (!chapterData || !Array.isArray(chapterData.docs)) {
        logger.warn(`[章节列表] 获取ID为 ${comicId} 的章节列表失败，API响应无效`, { responseData: response.data })
        break;
      }
      
      if (currentPage === 1) {
        totalPages = chapterData.pages
      }
      
      const chaptersOnPage = chapterData.docs.map(doc => ({ order: doc.order, id: doc._id }))
      allChapters.push(...chaptersOnPage)
      
      currentPage++
      if (currentPage <= totalPages) await sleep(500)

    } while (currentPage <= totalPages)
    
    return allChapters.sort((a, b) => a.order - b.order);
  }

  ctx.on('ready', () => login())

  // --- 指令注册 ---
  ctx.command('picasearch <keyword:text>', 'PicACG 漫画搜索 (仅展示前10个结果)')
    .action(async ({ session }, keyword) => {
      if (!keyword) return '请输入关键词。'
      
      const statusMessage = await session.send(h('quote', { id: session.messageId }) + '正在搜索...')
      
      try {

        if (config.debug) logger.info(`[搜索] 开始搜索，关键词: "${keyword}"`)
        const authToken = await ensureToken()
        if (!authToken) {
          logger.warn(`[搜索] 获取 Token 失败，无法继续搜索。`)
          return h('quote', { id: session.messageId }) + '登录失败，无法执行操作。'
        }
        
        const requestPath = `comics/search?page=1&q=${encodeURIComponent(keyword)}`
        const headers = buildHeaders('GET', requestPath, authToken)
        
        const response = await ctx.http.get(`${config.apiHost}/${requestPath}`, { headers })
        const result = response.data?.comics
        if (!result || !Array.isArray(result.docs) || result.docs.length === 0) {
          if (config.debug) logger.info(`[搜索] 未找到关键词 "${keyword}" 的任何结果。`)
          return h('quote', { id: session.messageId }) + '未找到任何结果。'
        }

        const top10Results = result.docs.slice(0, 10);
        if (config.debug) logger.info(`[搜索] 成功！关键词 "${keyword}" 找到 ${result.total} 个结果，将展示 ${top10Results.length} 个。`)
        
        const messageElements: h[] = [
          h('p', `搜索到 ${result.total} 个结果，为您展示前 ${top10Results.length} 个：`)
        ];

        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        for (const [index, comic] of top10Results.entries()) {
          messageElements.push(h('p', '──────────'));

          const emoji = numberEmojis[index] || `${index + 1}.`;
          const textInfo = `${emoji} [ID] ${comic._id}\n[标题] ${comic.title}\n[作者] ${comic.author}`;
          messageElements.push(h('p', textInfo));

          if (config.showImageInSearch && comic.thumb && comic.thumb.fileServer && comic.thumb.path) {
            const imageUrl = `${comic.thumb.fileServer}/static/${comic.thumb.path}`;
            messageElements.push(h.image(imageUrl));
          }
        }

        if (config.useForwardForSearch) {
          await session.send(h('figure', {}, messageElements))
        } else {
          await session.send(messageElements)
        }

      } catch (error) {
        logger.error(`[搜索] 请求失败。关键词: "${keyword}"`, { error: error.response?.data || error.message })
        return h('quote', { id: session.messageId }) + '搜索失败，请查看后台日志。'
      } finally {
        try {
          await session.bot.deleteMessage(session.channelId, statusMessage[0])
        } catch (e) {
          if (config.debug) logger.warn('撤回状态消息失败', e)
        }
      }
    })

  ctx.command('picaid <comicId:string> [chapter:string]', 'PicACG 漫画下载')
    .option('output', '-o <type:string>')
    .action(async ({ session, options }, comicId, chapter) => {
      if (!comicId) return '请输入正确的漫画 ID。'
      
      const statusMessage = await session.send(h('quote', { id: session.messageId }) + `请求下载漫画 ${comicId}...`)
      
      try {
        const authToken = await ensureToken()
        if (!authToken) {
          return h('quote', { id: session.messageId }) + '登录失败，无法执行操作。'
        }
        
        const getImageUrlsForChapter = async (order: number) => {
          const path = `comics/${comicId}/order/${order}/pages`
          let urls: string[] = []
          let currentPage = 1
          let totalPages = 1
          do {
            const headers = buildHeaders('GET', `${path}?page=${currentPage}`, authToken)
            const response = await ctx.http.get(`${config.apiHost}/${path}?page=${currentPage}`, { headers })
            if (!response?.data?.pages?.docs || !Array.isArray(response.data.pages.docs)) {
              throw new Error(`获取章节 ${order} 失败: API响应无效`)
            }
            const pageData = response.data.pages
            if (currentPage === 1) {
              totalPages = pageData.pages
              if (pageData.total === 0) return []
            }
            const validDocs = pageData.docs.filter(doc => doc && doc.media && doc.media.fileServer && doc.media.path)
            urls.push(...validDocs.map(doc => `${doc.media.fileServer}/static/${doc.media.path}`))
            currentPage++
            if (currentPage <= totalPages) await sleep(500)
          } while (currentPage <= totalPages)
          return urls
        }

        let allImageUrls: string[] = [];
        let isFullDownload = false;
        let chapterForTitle: string | number = 1;

        if (!chapter) {
          if (config.debug) logger.info(`[下载] 未指定章节，默认下载第 1 话。ID: ${comicId}`)
          allImageUrls = await getImageUrlsForChapter(1);
        } else if (chapter.toLowerCase() === 'full') {
          if (config.debug) logger.info(`[下载] full 模式启动。ID: ${comicId}`)
          isFullDownload = true;
          const chapters = await getComicChapters(comicId);
          if (chapters.length === 0) return '无法获取该漫画的任何章节信息。'
          
          for (const [index, chap] of chapters.entries()) {
            if (config.debug) logger.info(`[下载] [Full] 正在处理第 ${index + 1}/${chapters.length} 话 (章节序号: ${chap.order})`)
            const urls = await getImageUrlsForChapter(chap.order);
            allImageUrls.push(...urls);
          }
        } else if (/^\d+$/.test(chapter)) {
          chapterForTitle = parseInt(chapter, 10);
          if (config.debug) logger.info(`[下载] 指定下载第 ${chapterForTitle} 话。ID: ${comicId}`)
          allImageUrls = await getImageUrlsForChapter(chapterForTitle);
        } else {
          return '章节参数不合法。请输入一个数字，或 "full"。'
        }

        if (allImageUrls.length === 0) {
          return h('quote', { id: session.messageId }) + '未能获取到任何图片链接，任务中止。'
        }

        const outputType = options.output || (config.defaultToPdf ? 'pdf' : 'image');

        if (outputType === 'pdf') {
          if (config.debug) logger.info(`[下载] [PDF] 已获取 ${allImageUrls.length} 张图片，准备生成。`)
          
          const comicInfo = await getComicInfo(comicId)
          const comicTitle = comicInfo?.title || comicId
          
          const finalPart = isFullDownload ? '_全部章节' : `_第${chapterForTitle}话`
          const safeFilename = comicTitle.replace(/[\\/:\*\?"<>\|]/g, '_') + finalPart
          
          const downloadDir = path.resolve(ctx.app.baseDir, config.downloadPath)
          const tempPdfPath = path.resolve(downloadDir, `${safeFilename}_${Date.now()}.pdf`)
          const tempImageDir = path.resolve(downloadDir, `temp_${comicId}_${chapter || 'full'}_${Date.now()}`)
          await mkdir(tempImageDir, { recursive: true })
          
          let recipe: Recipe;
          try {
            recipe = new Recipe("new", tempPdfPath, { version: 1.6 });
            for (const [index, imageUrl] of allImageUrls.entries()) {
                const imageName = `${index + 1}.jpg`
                const imagePath = path.resolve(tempImageDir, imageName)
                const imageBuffer = await ctx.http.get(imageUrl, { responseType: 'arraybuffer' })
                const sharpInstance = sharp(imageBuffer);
                const jpegOptions: sharp.JpegOptions = {};
                if (config.enableCompression) {
                  jpegOptions.quality = config.compressionQuality;
                }
                await sharpInstance.jpeg(jpegOptions).toFile(imagePath);
                const metadata = await sharp(imagePath).metadata();
                recipe.createPage(metadata.width, metadata.height).image(imagePath, 0, 0).endPage();
            }
            if (config.pdfPassword) {
                if (config.debug) logger.info(`[下载] [PDF] 检测到密码设置，正在加密文件: ${safeFilename}.pdf`)
                recipe.encrypt({ userPassword: config.pdfPassword, ownerPassword: config.pdfPassword });
            }
            recipe.endPDF();
            
            if (config.pdfSendMethod === 'buffer') {
              if (config.debug) logger.info(`[下载] [PDF] 使用 Buffer 模式发送文件...`)
              const pdfBuffer = await readFile(tempPdfPath)
              await session.send(h.file(pdfBuffer, 'application/pdf', { title: `${safeFilename}.pdf` }))
            } else {
              if (config.debug) logger.info(`[下载] [PDF] 使用 File 模式发送文件...`)
              const fileUrl = pathToFileURL(tempPdfPath)
              await session.send(h.file(fileUrl.href, { title: `${safeFilename}.pdf` }))
            }
            
          } finally {
            try { await unlink(tempPdfPath) } catch (e) {}
            try { await rm(tempImageDir, { recursive: true, force: true }) } catch(e) {}
          }
        } else {
          if (isFullDownload) {
            return '`full` 模式暂不支持以图片形式发送，请使用 PDF 模式。'
          }
          if (config.debug) logger.info(`[下载] [Image] 已获取 ${allImageUrls.length} 张图片，准备发送。ID: ${comicId}, 章节: ${chapterForTitle}`)

          if (config.useForwardForImages) {
            if (config.debug) logger.info(`[下载] [Image] 采用合并转发模式发送 ${allImageUrls.length} 张图片。`)
            const forwardElements = allImageUrls.map(url => h.image(url))
            await session.send(h('figure', {}, forwardElements))
          } else {
            if (config.debug) logger.info(`[下载] [Image] 采用逐张发送模式，共 ${allImageUrls.length} 张图片。`)
            for (const [index, imageUrl] of allImageUrls.entries()) {
              try {
                const message = h('p', `第 ${index + 1} / ${allImageUrls.length} 张`).toString() + h.image(imageUrl).toString()
                await session.send(message)
              } catch (error) {
                logger.warn(`[下载] 发送单张图片失败。ID: ${comicId}, 章节: ${chapterForTitle}, 图片URL: ${imageUrl}`, { error })
                await session.send(`发送第 ${index + 1} 张图片失败，已跳过。`)
              }
              await sleep(1500)
            }
          }
        }

      } catch (error) {
        logger.error(`[下载] 任务失败。ID: ${comicId}, 章节: ${chapter}`, { error: error.message, stack: error.stack })
        return h('quote', { id: session.messageId }) + `下载失败：${error.message}`
      } finally {
        try {
          await session.bot.deleteMessage(session.channelId, statusMessage[0])
        } catch (e) {
          if (config.debug) logger.warn('撤回状态消息失败', e)
        }
      }
    })
}