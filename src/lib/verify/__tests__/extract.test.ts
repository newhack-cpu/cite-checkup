import { describe, expect, it } from "vitest";
import {
  detectKind,
  extractArxivId,
  extractDoi,
  extractYear,
  guessTitle,
  guessVenue,
  parseReference,
  splitReferences,
} from "../extract";

describe("splitReferences", () => {
  it("按 [n] 序号切分，并把续行拼回上一条", () => {
    const text = `参考文献
[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature,
2015, 521(7553): 436-444.
[2] 周志华. 机器学习[M]. 北京: 清华大学出版社, 2016.
［3］ Hochreiter S, Schmidhuber J. Long short-term memory[J]. Neural Computation, 1997, 9(8): 1735-1780.`;
    const refs = splitReferences(text);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toBe("LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.");
    expect(refs[1].startsWith("周志华")).toBe(true);
    expect(refs[2].startsWith("Hochreiter")).toBe(true);
  });

  it("按 1. 序号切分，不把 DOI 或年份当成序号", () => {
    const text = `1. Walters, W. H., & Wilder, E. I. (2023). Fabrication and errors. Scientific Reports, 13, 14045.
10.1038/s41598-023-41032-5
2. He, K. (2016). Deep residual learning. CVPR.`;
    const refs = splitReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toContain("10.1038/s41598-023-41032-5");
  });

  it("无序号时按空行分段，再退化到按行", () => {
    expect(splitReferences("Smith, J. (2020). A title here.\n\nDoe, J. (2021). Another title.")).toHaveLength(2);
    expect(splitReferences("Smith, J. (2020). A title here.\nDoe, J. (2021). Another title.")).toHaveLength(2);
  });
});

describe("extractDoi", () => {
  it("去掉末尾标点", () => {
    expect(extractDoi("Nature, 2015. https://doi.org/10.1038/nature14539.")).toBe("10.1038/nature14539");
    expect(extractDoi("DOI: 10.1038/s41598-023-41032-5;")).toBe("10.1038/s41598-023-41032-5");
  });
  it("保留 DOI 自身的括号，只去掉不配对的右括号", () => {
    expect(extractDoi("The Lancet (doi:10.1016/S0140-6736(97)11096-0)")).toBe("10.1016/s0140-6736(97)11096-0");
  });
  it("没有 DOI 时返回 undefined", () => {
    expect(extractDoi("周志华. 机器学习[M]. 北京: 清华大学出版社, 2016.")).toBeUndefined();
  });
});

describe("extractYear", () => {
  const now = new Date("2026-10-14");
  it("APA 括号年份", () => expect(extractYear("Walters, W. H. (2023). Title. Journal, 13, 14045.", now)).toBe(2023));
  it("GB/T 逗号间年份，不误取页码", () => expect(extractYear("Deep learning[J]. Nature, 2015, 521(7553): 1436-1444.", now)).toBe(2015));
  it("忽略 DOI 里的数字", () => expect(extractYear("Title. 2019. https://doi.org/10.1000/2020.1234", now)).toBe(2019));
  it("不接受未来年份", () => expect(extractYear("Title, 2031, 3(2).", now)).toBeUndefined());
});

describe("detectKind", () => {
  it("识别 GB/T 类型标识", () => {
    expect(detectKind("Deep learning[J]. Nature, 2015")).toBe("journal");
    expect(detectKind("机器学习[M]. 北京: 清华大学出版社, 2016.")).toBe("book");
    expect(detectKind("研究[D]. 武汉: 武汉大学, 2020.")).toBe("thesis");
    expect(detectKind("统计公报[EB/OL]. (2024-02-29).")).toBe("web");
    expect(detectKind("Title[C]//Proceedings of CVPR. 2016")).toBe("conference");
  });
  it("GB/T 里标成 [J] 的 arXiv 论文按预印本处理", () => {
    const p = parseReference("Vaswani A, Shazeer N, Parmar N, et al. Attention is all you need[J]. arXiv preprint arXiv:1706.03762, 2017.", 1);
    expect(p.kind).toBe("preprint");
    expect(p.venueGuess).toBeUndefined();
  });
  it("按关键词推断英文文献类型", () => {
    expect(detectKind("Vaswani A. Attention is all you need. arXiv preprint arXiv:1706.03762")).toBe("preprint");
    expect(detectKind('K. He, "Deep residual learning," in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), 2016')).toBe("conference");
    expect(detectKind("Goodfellow, I. (2016). Deep learning. MIT Press.")).toBe("book");
  });
});

describe("guessTitle / guessVenue", () => {
  it("GB/T", () => {
    const s = "LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.";
    expect(guessTitle(s)).toBe("Deep learning");
    expect(guessVenue(s)).toBe("Nature");
  });
  it("APA", () => {
    const s = "Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Computation, 9(8), 1735–1780.";
    const t = guessTitle(s);
    expect(t).toBe("Long short-term memory");
    expect(guessVenue(s, t)).toBe("Neural Computation");
  });
  it("APA 期刊名带括号", () => {
    const s =
      "Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: A practical and powerful approach to multiple testing. Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289–300.";
    const t = guessTitle(s);
    expect(t).toBe("Controlling the false discovery rate: A practical and powerful approach to multiple testing");
    expect(guessVenue(s, t)).toBe("Journal of the Royal Statistical Society: Series B");
  });
  it("IEEE 引号题名", () => {
    expect(guessTitle('K. He, X. Zhang, "Deep residual learning for image recognition," in Proc. CVPR, 2016.')).toBe(
      "Deep residual learning for image recognition",
    );
  });
  it("中文 GB/T", () => {
    const s = "金旭杨. 基于深度学习的工程图像识别与分类研究[J]. 工程学研究与实用, 2025.";
    expect(guessTitle(s)).toBe("基于深度学习的工程图像识别与分类研究");
    expect(guessVenue(s)).toBe("工程学研究与实用");
  });
});

describe("parseReference", () => {
  it("arXiv 编号转换成 DataCite DOI", () => {
    const p = parseReference("Vaswani A, et al. Attention is all you need[J]. arXiv preprint arXiv:1706.03762, 2017.", 1);
    expect(extractArxivId(p.raw)).toBe("1706.03762");
    expect(p.doi).toBe("10.48550/arxiv.1706.03762");
    expect(p.year).toBe(2017);
  });
  it("中文识别", () => {
    expect(parseReference("周志华. 机器学习[M]. 北京: 清华大学出版社, 2016.", 1).lang).toBe("zh");
  });
});
