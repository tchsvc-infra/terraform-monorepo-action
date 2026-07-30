import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/main.ts',
  output: {
    file: 'detect/dist/index.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    typescript({ noEmit: false, sourceMap: true }),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
  ],
}
