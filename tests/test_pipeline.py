from firms_pipeline import index_to_ym, month_index, region_of


def test_month_index_start():
    assert int(month_index(2002, 7)) == 0


def test_index_to_ym():
    assert index_to_ym(115) == (2012, 2)


def test_region_of_chaco():
    assert str(region_of(-22, -60)) == "chaco"


def test_region_of_oriental():
    assert str(region_of(-25.3, -55)) == "oriental"
