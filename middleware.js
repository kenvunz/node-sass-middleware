var sass = require('node-sass'),
    fs = require('fs'),
    url = require('url'),
    dirname = require('path').dirname,
    mkdirp = require('mkdirp'),
    join = require('path').join;

var imports = {};

/**
 * Return Connect middleware with the given `options`.
 *
 * Options:
 *
 *    `force`       Always re-compile
 *    `debug`       Output debugging information
 *    `src`         Source directory used to find .scss files
 *    `dest`        Destination directory used to output .css files
 *                  when undefined defaults to `src`.
 *    `outputStyle` Sass output style (nested,expanded, compact or compressed)
 *    `response`    Always write output directly to response
 *
 * Examples:
 *
 * Pass the middleware to Connect, grabbing .scss files from this directory
 * and saving .css files to _./public_.
 *
 * Following that we have a `staticProvider` layer setup to serve the .css
 * files generated by Sass.
 *
 *      var server = connect.createServer(
 *          sass.middleware({
 *              src: __dirname
 *            , dest: __dirname + '/public'
 *          })
 *        , connect.static(__dirname + '/public')
 *      );
 *
 * @param {Object} options
 * @return {Function}
 * @api public
 */

module.exports = function(options){
  options = options || {};

  // Accept src/dest dir
  if ('string' == typeof options) {
    options = { src: options };
  }

  // Force compilation
  var force = options.force || options.response;

  // Debug option
  var debug = options.debug;

  // Source dir required
  var src = options.src;
  if (!src) { throw new Error('sass.middleware() requires "src" directory'); }

  // Default dest dir to source
  var dest = options.dest || src;

  var root = options.root || null;

  // Default compile callback
  options.compile = options.compile || function(){
    return sass;
  };

  // Middleware
  return function sass(req, res, next){
    if ('GET' != req.method && 'HEAD' != req.method) { return next(); }
    var path = url.parse(req.url).pathname;
    if (options.prefix && 0 === path.indexOf(options.prefix)) {
      path = path.substring(options.prefix.length);
    }
    if (/\.css$/.test(path)) {
      var cssPath = join(dest, path),
          sassPath = join(src, path.replace('.css', '.scss')),
          sassDir = dirname(sassPath);

      if (root) {
        cssPath = join(root, dest, path.replace(dest, ''));
        sassPath = join(root, src, path
            .replace(dest, '')
            .replace('.css', '.scss'));
        sassDir = dirname(sassPath);
      }

      if (debug) {
        log('source', sassPath);
        log('dest', options.response ? '<response>' : cssPath);
      }

      // Ignore ENOENT to fall through as 404
      var error = function(err) {
        next('ENOENT' == err.code
          ? null
          : err);
      };

      // When render is done, respond to the request accordingly
      var done = function(err, result) {
        var data;

        if (err) {
          var fileLineColumn = sassPath + ':' + err.line + ':' + err.column;
          var message = err.message + ' in ' + fileLineColumn;
          data = '/*\n' + message + '\n*/\nbody:before { white-space: pre; font-family: monospace; content: "' + message.replace(/\n/g, "\\A ") + '"';

          if (debug) logError(data);
          if (options.error) options.error(err);
        } else {
          data = result.css;

          if (debug) { log('render', options.response ? '<response>' : sassPath); }
          imports[sassPath] = result.stats.includedFiles;

          // If response is falsey, also write to file
          if (!options.response) {
              mkdirp(dirname(cssPath), 0700, function(err){
                  if (err) return error(err);
                  fs.writeFile(cssPath, data, 'utf8', function(err) {
                      if (err) return error(err);
                  });
              });
          }
        }

        res.writeHead(200, {
            'Content-Type': 'text/css',
            'Cache-Control': 'max-age=0'
        });
        res.end(data);
      }

      // Compile to cssPath
      var compile = function() {
        if (debug) { log('read', cssPath); }
        fs.readFile(sassPath, 'utf8', function(err, str){
          if (err) { return error(err); }
          var style = options.compile();
          delete imports[sassPath];
          style.render({
            data: str,
            importer: options.importer,
            includePaths: [ sassDir ].concat(options.include_paths || options.includePaths || []),
            imagePath: options.image_path || options.imagePath,
            outputStyle: options.output_style || options.outputStyle
          }, done);
        });
      };

      // Force
      if (force) { return compile(); }

      // Re-compile on server restart, disregarding
      // mtimes since we need to map imports
      if (!imports[sassPath]) { return compile(); }

      // Compare mtimes
      fs.stat(sassPath, function(err, sassStats){
        if (err) { return error(err); }
        fs.stat(cssPath, function(err, cssStats){
          // CSS has not been compiled, compile it!
          if (err) {
            if ('ENOENT' == err.code) {
              if (debug) { log('not found', cssPath); }
              compile();
            } else {
              next(err);
            }
          } else {
            // Source has changed, compile it
            if (sassStats.mtime > cssStats.mtime) {
              if (debug) { log('modified', cssPath); }
              compile();
            // Already compiled, check imports
            } else {
              checkImports(sassPath, cssStats.mtime, function(changed){
                if (debug && changed && changed.length) {
                  changed.forEach(function(path) {
                    log('modified import %s', path);
                  });
                }
                changed && changed.length ? compile() : next();
              });
            }
          }
        });
      });
    } else {
      next();
    }
  };
};

/**
 * Check `path`'s imports to see if they have been altered.
 *
 * @param {String} path
 * @param {Function} fn
 * @api private
 */

function checkImports(path, time, fn) {

  var nodes = imports[path];
  if (!nodes) { return fn(); }
  if (!nodes.length) { return fn(); }

  var pending = nodes.length,
      changed = [];

  nodes.forEach(function(imported){
    fs.stat(imported, function(err, stat){
      // error or newer mtime
      if (err || stat.mtime > time) {
        changed.push(imported);
      }
      --pending || fn(changed);
    });
  });
}

/**
 * Log a message.
 *
 * @api private
 */

function log(key, val) {
  console.error('  \033[90m%s :\033[0m \033[36m%s\033[0m', key, val);
}

/**
 * Log an error message.
 *
 * @api private
 */

function logError(message) {
  log('error', '\007\033[31m' + message + '\033[91m')
}
