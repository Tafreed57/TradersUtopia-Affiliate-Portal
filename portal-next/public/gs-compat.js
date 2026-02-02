/**
 * google.script.run Compatibility Shim
 *
 * This script provides a drop-in replacement for google.script.run calls.
 * It redirects all calls to the /api/gs-call endpoint.
 *
 * Usage in legacy HTML:
 * 1. Include this script: <script src="/gs-compat.js"></script>
 * 2. Existing google.script.run calls work without modification
 *
 * The shim creates a global `google.script.run` object that mimics the GAS API.
 */

(function (global) {
  'use strict';

  // Configuration
  const API_ENDPOINT = '/api/gs-call';
  const DEBUG = false; // Set to true for console logging

  /**
   * Log helper
   */
  function log(...args) {
    if (DEBUG) {
      console.log('[gs-compat]', ...args);
    }
  }

  /**
   * Create a chainable runner that builds up handlers and executes
   */
  function createRunner() {
    let successHandler = null;
    let failureHandler = null;
    let userObject = null;

    /**
     * Execute the actual API call
     */
    async function executeCall(functionName, args) {
      log('Calling:', functionName, 'with args:', args);

      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            function: functionName,
            args: args,
          }),
        });

        const data = await response.json();

        log('Response:', data);

        if (data.success) {
          if (successHandler) {
            // Call success handler with result and user object
            if (userObject !== null) {
              successHandler.call(null, data.result, userObject);
            } else {
              successHandler.call(null, data.result);
            }
          }
          return data.result;
        } else {
          const error = new Error(data.error || 'Unknown error');
          if (failureHandler) {
            failureHandler.call(null, error);
          } else {
            console.error('[gs-compat] Unhandled error:', error);
          }
          throw error;
        }
      } catch (error) {
        log('Error:', error);
        if (failureHandler) {
          failureHandler.call(null, error);
        } else {
          console.error('[gs-compat] Unhandled error:', error);
        }
        throw error;
      }
    }

    /**
     * Create a proxy that captures function name and arguments
     */
    const runner = new Proxy(
      {},
      {
        get: function (target, prop) {
          // Handle chainable methods
          if (prop === 'withSuccessHandler') {
            return function (handler) {
              successHandler = handler;
              return runner;
            };
          }
          if (prop === 'withFailureHandler') {
            return function (handler) {
              failureHandler = handler;
              return runner;
            };
          }
          if (prop === 'withUserObject') {
            return function (obj) {
              userObject = obj;
              return runner;
            };
          }

          // Any other property is treated as a function name
          return function (...args) {
            return executeCall(prop, args);
          };
        },
      }
    );

    return runner;
  }

  // Create the google.script.run object
  const googleScript = {
    run: new Proxy(
      {},
      {
        get: function (target, prop) {
          // Create a new runner for each chain
          const runner = createRunner();

          // Handle chainable methods
          if (
            prop === 'withSuccessHandler' ||
            prop === 'withFailureHandler' ||
            prop === 'withUserObject'
          ) {
            return runner[prop];
          }

          // Direct function call without handlers
          return function (...args) {
            return runner[prop](...args);
          };
        },
      }
    ),
  };

  // Create the google namespace if it doesn't exist
  if (!global.google) {
    global.google = {};
  }

  // Assign our compatibility shim
  global.google.script = googleScript;

  log('Compatibility shim loaded');

  // Export for module environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = googleScript;
  }
})(typeof window !== 'undefined' ? window : global);
