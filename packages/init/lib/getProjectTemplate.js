const { request } = require('@wqas-cli/utils');

module.exports = function() {
  return request({
    url: '/project/template',
  });
};
