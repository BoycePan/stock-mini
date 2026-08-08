package com.guyu.stock.external.cninfo;

import com.guyu.stock.common.fetcher.DataSource;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CninfoClientTest {

    @Test
    void parsesAnnouncementsAndBuildsUrls() {
        String body = "{\"announcements\":[{\"announcementId\":\"a1\",\"announcementTitle\":\"年报\"," +
                "\"announcementTime\":1723000000000,\"adjunctUrl\":\"/pdf/1.pdf\"}]}";
        DataSource stub = new DataSource("stub", 0, 0, null, null) {
            @Override public String postForm(String url, java.util.Map<String, String> form) {
                assertThat(form.get("stock")).isEqualTo("600519,gssh0600519");
                return body;
            }
        };
        CninfoClient client = new CninfoClient(stub);
        List<Announcement> items = client.fetchAnnouncements("600519", 1, 20);
        assertThat(items).hasSize(1);
        assertThat(items.get(0).title()).isEqualTo("年报");
        assertThat(items.get(0).time()).matches("\\d{4}-\\d{2}-\\d{2}");
        assertThat(items.get(0).pdf()).isEqualTo("https://static.cninfo.com.cn/pdf/1.pdf");
    }
}
