import { promises as fs } from 'fs';
import axios from 'axios';
import path from 'path';
import cheerio from 'cheerio';
import buildDebug from 'debug';
import Listr from 'listr';
import { URL } from 'url';
import _ from 'lodash';

const debug = buildDebug('page-loader');

const getName = (pageUrl, nameType = 'file') => {
  const linkWithoutProtocol = `${pageUrl.hostname}${pageUrl.pathname}`
    .replace(/\//g, '-')
    .replace(/\./, '-');

  const nameMapping = {
    file: `${_.trimStart(pageUrl.pathname, '/').replace(/\//g, '-')}`,
    page: `${linkWithoutProtocol}.html`,
    directory: `${linkWithoutProtocol}_files`,
  };

  debug(`${nameMapping[nameType]} name has been created for ${nameType} of ${pageUrl.href}`);

  return nameMapping[nameType];
};

const downloadResource = (outputDirname, filesDirname, resource) => {
  const writingPath = path.join(outputDirname, filesDirname, resource.resourceName);

  debug(`Download resource from ${resource.downloadingLink}`);

  return axios({
    method: 'get',
    url: resource.downloadingLink,
    responseType: 'arraybuffer',
  })
    .then((response) => fs.writeFile(writingPath, response.data));
};

const changeLinksOnPage = (html, filesDirectoryName, urlOrigin) => {
  const $ = cheerio.load(html, { xmlMode: true, decodeEntities: false });

  const mapping = {
    img: 'src',
    link: 'href',
    script: 'src',
  };

  const resources = [];

  Object.entries(mapping).forEach((entry) => {
    const [tagName, attrName] = entry;

    $(tagName).toArray()
      .filter((tag) => {
        const oldLink = $(tag).attr(attrName);
        const downloadingLink = new URL(oldLink, urlOrigin);

        return downloadingLink.origin === urlOrigin;
      })
      .forEach((tag) => {
        const oldLink = $(tag).attr(attrName);
        const downloadingLink = new URL(oldLink, urlOrigin);
        const resourceName = getName(downloadingLink);
        const newLink = path.join(filesDirectoryName, resourceName);
        $(tag).attr(attrName, newLink);

        const resource = {
          resourceName,
          downloadingLink: downloadingLink.toString(),
        };

        resources.push(resource);
      });
  });

  debug('Extracted local links:', resources);

  return {
    html: $.html(),
    resources,
  };
};

export default (outputDirname, url) => {
  const pageUrl = new URL(url);
  const pagename = getName(pageUrl, 'page');
  const filesDirname = getName(pageUrl, 'directory');

  let changedPageInformation;

  debug(`Request to ${pageUrl.href}`);

  return axios(pageUrl.href)
    .then((response) => {
      const html = response.data;
      changedPageInformation = changeLinksOnPage(
        html,
        filesDirname,
        pageUrl.origin,
      );
    })
    .then(() => fs.mkdir(path.join(outputDirname, filesDirname)))
    .then(() => {
      const tasksForListr = changedPageInformation.resources.map((resource) => ({
        title: resource.downloadingLink,
        task: () => downloadResource(
          outputDirname,
          filesDirname,
          resource,
        ),
      }));

      const listrTasks = new Listr(tasksForListr, { concurrent: true });

      return listrTasks.run();
    })
    .then(() => {
      const writingPath = path.join(outputDirname, pagename);
      return fs.writeFile(writingPath, changedPageInformation.html);
    });
};
