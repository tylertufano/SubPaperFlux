import Document, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document'
import { getCachedFeatureFlags, type FeatureFlags } from '../lib/featureFlags'
import { getInlineThemeScript } from '../lib/theme'

type DocumentProps = DocumentInitialProps & {
  featureFlags?: FeatureFlags | null
}

class MyDocument extends Document<DocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<DocumentProps> {
    const initialProps = await Document.getInitialProps(ctx)
    const featureFlags = getCachedFeatureFlags()
    return { ...initialProps, featureFlags }
  }

  render() {
    const { featureFlags } = this.props
    return (
      <Html lang="en">
        <Head>
          <script
            id="__spf_theme"
            dangerouslySetInnerHTML={{
              __html: getInlineThemeScript(),
            }}
          />
        </Head>
        <body>
          <Main />
          {featureFlags ? (
            <script
              id="__spf_feature_flags"
              dangerouslySetInnerHTML={{
                __html: `window.__SPF_FEATURE_FLAGS=${JSON.stringify(featureFlags)};`,
              }}
            />
          ) : null}
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default MyDocument

