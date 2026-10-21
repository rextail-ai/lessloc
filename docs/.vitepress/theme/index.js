import { h } from 'vue';
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import './custom.css';

// The home banner as animated WebP, a quarter of the GIF's weight, with the GIF for browsers without WebP. Two copies: the
// "system" one picks the image for the system color scheme, and the "other" one the opposite image, for a visitor who chose the
// other appearance. The CSS shows the copy that matches the page. The system copy is the page's largest paint, so it loads
// first and at once; the other is lazy, and a hidden lazy image is never fetched.
const gif = src => src.replace(/\.webp$/, '.gif');
const banner = (copy, dark, light, alt, load) => h('picture', { class: `banner ${copy}` }, [
  h('source', { media: '(prefers-color-scheme: dark)', type: 'image/webp', srcset: dark }),
  h('source', { media: '(prefers-color-scheme: dark)', srcset: gif(dark) }),
  h('source', { type: 'image/webp', srcset: light }),
  h('img', { class: 'image-src', src: gif(light), alt, width: 1000, height: 300, decoding: 'async', ...load }),
]);
const banners = () => {
  const image = useData().frontmatter.value.hero?.image;
  return image ? [banner('system', image.dark, image.light, image.alt, { fetchpriority: 'high' }), banner('other', image.light, image.dark, image.alt, { loading: 'lazy' })] : [];
};

export default { extends: DefaultTheme, Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-image': banners }) };
